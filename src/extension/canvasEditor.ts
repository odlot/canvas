import * as vscode from 'vscode';
import { fileKind, isTextKind } from '../shared/fileKinds';
import type { HostToWebview, ResolvedFile, WebviewToHost } from '../shared/protocol';
import { parseCanvas, serializeCanvas } from '../shared/validate';

/** Files larger than this are shown truncated in text/code nodes. */
const MAX_TEXT_BYTES = 256 * 1024;

/**
 * Custom editor for `*.canvas` files. The TextDocument is the single source of
 * truth: the webview sends whole-canvas edits which we apply as a WorkspaceEdit,
 * so save / dirty state / undo / redo / diff all work like any text file.
 */
export class CanvasEditorProvider implements vscode.CustomTextEditorProvider {
	static readonly viewType = 'canvas.editor';

	constructor(private readonly context: vscode.ExtensionContext) {}

	static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(CanvasEditorProvider.viewType, new CanvasEditorProvider(context), {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true,
		});
	}

	async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		new CanvasSession(this.context, document, panel);
	}
}

class CanvasSession {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly watchers = new Map<string, vscode.Disposable>();
	/** Text we last wrote, so we don't echo our own edits back to the webview. */
	private lastWrittenText: string | undefined;
	private readonly webview: vscode.Webview;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly document: vscode.TextDocument,
		private readonly panel: vscode.WebviewPanel,
	) {
		this.webview = panel.webview;
		const roots = [vscode.Uri.joinPath(context.extensionUri, 'dist'), vscode.Uri.joinPath(context.extensionUri, 'media')];
		for (const f of vscode.workspace.workspaceFolders ?? []) {
			roots.push(f.uri);
		}
		if (document.uri.scheme !== 'untitled') {
			roots.push(vscode.Uri.joinPath(document.uri, '..'));
		}
		this.webview.options = { enableScripts: true, localResourceRoots: roots };
		this.webview.html = this.html();

		this.disposables.push(
			this.webview.onDidReceiveMessage((m: WebviewToHost) => this.onMessage(m)),
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) {
					return;
				}
				if (this.lastWrittenText !== undefined && e.document.getText() === this.lastWrittenText) {
					// Our own edit echoing back; consume it so a later redo to the same text still syncs.
					this.lastWrittenText = undefined;
					return;
				}
				this.lastWrittenText = undefined;
				this.sendLoad();
			}),
			panel.onDidDispose(() => this.dispose()),
		);
	}

	private dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
		for (const w of this.watchers.values()) {
			w.dispose();
		}
		this.watchers.clear();
	}

	private post(message: HostToWebview): void {
		void this.webview.postMessage(message);
	}

	private sendLoad(): void {
		const text = this.document.getText();
		const { canvas, issues } = parseCanvas(text);
		this.post({ type: 'load', canvas, issues, text });
	}

	private async onMessage(m: WebviewToHost): Promise<void> {
		switch (m.type) {
			case 'ready':
				this.sendLoad();
				break;
			case 'edit':
				await this.applyEdit(serializeCanvas(m.canvas));
				break;
			case 'requestFile':
				this.post({ type: 'file', file: await this.resolveFile(m.path) });
				this.watch(m.path);
				break;
			case 'openFile': {
				const uri = await this.locate(m.path);
				if (uri) {
					await vscode.commands.executeCommand('vscode.open', uri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
				} else {
					void vscode.window.showWarningMessage(`Canvas: file not found: ${m.path}`);
				}
				break;
			}
			case 'openLink':
				if (/^https?:\/\//i.test(m.url)) {
					await vscode.env.openExternal(vscode.Uri.parse(m.url));
				}
				break;
			case 'pickFiles': {
				const picked = await vscode.window.showOpenDialog({
					canSelectMany: true,
					defaultUri: this.baseDir(),
					openLabel: 'Add to Canvas',
				});
				if (picked?.length) {
					this.post({ type: 'insertFiles', paths: picked.map((u) => this.toCanvasPath(u)), at: m.at });
				}
				break;
			}
			case 'resolveDrop': {
				const paths: string[] = [];
				for (const raw of m.uris) {
					try {
						const uri = vscode.Uri.parse(raw.trim(), true);
						if (uri.scheme === 'file' || uri.scheme === 'vscode-remote' || uri.scheme === this.document.uri.scheme) {
							paths.push(this.toCanvasPath(uri));
						}
					} catch {
						// ignore unparsable entries
					}
				}
				if (paths.length) {
					this.post({ type: 'insertFiles', paths, at: m.at });
				}
				break;
			}
			case 'openAsText':
				await vscode.commands.executeCommand('vscode.openWith', this.document.uri, 'default');
				break;
		}
	}

	private async applyEdit(text: string): Promise<void> {
		if (text === this.document.getText()) {
			return;
		}
		this.lastWrittenText = text;
		const edit = new vscode.WorkspaceEdit();
		const end = this.document.lineAt(this.document.lineCount - 1).range.end;
		edit.replace(this.document.uri, new vscode.Range(new vscode.Position(0, 0), end), text);
		await vscode.workspace.applyEdit(edit);
	}

	// --- file resolution -------------------------------------------------

	/** Folder that canvas-relative file paths are resolved against: the workspace folder, else the canvas's folder. */
	private baseDir(): vscode.Uri | undefined {
		const folder = vscode.workspace.getWorkspaceFolder(this.document.uri) ?? vscode.workspace.workspaceFolders?.[0];
		if (folder) {
			return folder.uri;
		}
		return this.document.uri.scheme === 'untitled' ? undefined : vscode.Uri.joinPath(this.document.uri, '..');
	}

	/**
	 * Candidate URIs for a canvas `file` path. Like Obsidian, paths are relative
	 * to the workspace (vault) root; we also try the canvas's own folder and
	 * absolute paths so hand-written canvases work.
	 */
	private candidates(path: string): vscode.Uri[] {
		const out: vscode.Uri[] = [];
		if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
			out.push(vscode.Uri.file(path));
		}
		const base = this.baseDir();
		if (base) {
			out.push(vscode.Uri.joinPath(base, path));
		}
		if (this.document.uri.scheme !== 'untitled') {
			out.push(vscode.Uri.joinPath(this.document.uri, '..', path));
		}
		return out;
	}

	private async locate(path: string): Promise<vscode.Uri | undefined> {
		for (const uri of this.candidates(path)) {
			try {
				const stat = await vscode.workspace.fs.stat(uri);
				if (stat.type & vscode.FileType.File) {
					return uri;
				}
			} catch {
				// try next
			}
		}
		return undefined;
	}

	private async resolveFile(path: string): Promise<ResolvedFile> {
		const uri = await this.locate(path);
		if (!uri) {
			return { path, exists: false };
		}
		const kind = fileKind(path);
		if (isTextKind(kind)) {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const truncated = bytes.byteLength > MAX_TEXT_BYTES;
			const text = new TextDecoder().decode(truncated ? bytes.slice(0, MAX_TEXT_BYTES) : bytes);
			return { path, exists: true, text, truncated };
		}
		return { path, exists: true, uri: this.webview.asWebviewUri(uri).toString() };
	}

	/** Path to store in the canvas for a picked/dropped file: workspace-relative with forward slashes. */
	private toCanvasPath(uri: vscode.Uri): string {
		const base = this.baseDir();
		if (base && uri.path.startsWith(base.path.replace(/\/$/, '') + '/')) {
			return uri.path.slice(base.path.replace(/\/$/, '').length + 1);
		}
		return uri.fsPath;
	}

	private watch(path: string): void {
		if (this.watchers.has(path)) {
			return;
		}
		const base = this.baseDir();
		if (!base) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, path));
		const refresh = async (): Promise<void> => this.post({ type: 'file', file: await this.resolveFile(path) });
		watcher.onDidChange(refresh);
		watcher.onDidCreate(refresh);
		watcher.onDidDelete(refresh);
		this.watchers.set(path, watcher);
	}

	// --- html ------------------------------------------------------------

	private html(): string {
		const asset = (p: string): vscode.Uri => this.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', p));
		const nonce = makeNonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${this.webview.cspSource} https: data: blob:`,
			`style-src ${this.webview.cspSource} 'unsafe-inline'`,
			`font-src ${this.webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`connect-src ${this.webview.cspSource}`,
			`worker-src blob:`,
		].join('; ');
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${asset('webview.css')}">
	<title>Canvas</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">window.CANVAS_PDF_WORKER = ${JSON.stringify(asset('pdf.worker.js').toString())};</script>
	<script nonce="${nonce}" type="module" src="${asset('webview.js')}"></script>
</body>
</html>`;
	}
}

function makeNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < 32; i++) {
		s += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return s;
}
