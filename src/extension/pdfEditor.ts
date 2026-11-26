import * as vscode from 'vscode';
import { initialLength, type PdfHostToWebview, type PdfWebviewToHost } from '../shared/pdfProtocol';
import { makeNonce } from './nonce';
import { memoryReader, openFileReader, type RangeReader } from './rangeReader';

/**
 * Read-only PDF viewer built on pdf.js's own viewer component (the one Firefox
 * uses): only pages near the viewport are rendered, and the file is streamed to
 * the webview in byte ranges on demand, so even ten-thousand-page manuals open
 * instantly.
 */
export class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
	static readonly viewType = 'canvas.pdf';

	constructor(private readonly context: vscode.ExtensionContext) {}

	static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(PdfEditorProvider.viewType, new PdfEditorProvider(context), {
			// Keeps the rendered pages and scroll position when switching tabs.
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true,
		});
	}

	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => undefined };
	}

	resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
		new PdfSession(this.context, document.uri, panel);
	}
}

class PdfSession {
	private readonly disposables: vscode.Disposable[] = [];
	private reader: Promise<RangeReader> | undefined;
	private generation = 0;
	private disposed = false;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly uri: vscode.Uri,
		private readonly panel: vscode.WebviewPanel,
	) {
		const webview = panel.webview;
		webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] };
		webview.html = this.html();

		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop()!),
		);
		watcher.onDidChange(() => this.load());
		watcher.onDidCreate(() => this.load());
		this.disposables.push(
			watcher,
			webview.onDidReceiveMessage((m: PdfWebviewToHost) => this.onMessage(m)),
			panel.onDidDispose(() => this.dispose()),
		);
	}

	private dispose(): void {
		this.disposed = true;
		for (const d of this.disposables) {
			d.dispose();
		}
		void this.closeReader();
	}

	private post(message: PdfHostToWebview): void {
		if (!this.disposed) {
			void this.panel.webview.postMessage(message);
		}
	}

	private async onMessage(m: PdfWebviewToHost): Promise<void> {
		switch (m.type) {
			case 'ready':
				await this.load();
				break;
			case 'range': {
				if (m.generation !== this.generation || !this.reader) {
					return;
				}
				try {
					const data = await (await this.reader).read(m.begin, m.end);
					if (m.generation === this.generation) {
						this.post({ type: 'range', generation: m.generation, begin: m.begin, data });
					}
				} catch (err) {
					this.post({ type: 'error', message: `Could not read ${this.name()}: ${String(err)}` });
				}
				break;
			}
		}
	}

	/** (Re)open the file and tell the webview to load it. */
	private async load(): Promise<void> {
		const generation = ++this.generation;
		await this.closeReader();
		const reader = (this.reader = this.openReader());
		try {
			const r = await reader;
			const initial = await r.read(0, initialLength(r.length));
			if (generation === this.generation) {
				this.post({ type: 'open', generation, name: this.name(), length: r.length, initial });
			}
		} catch (err) {
			this.post({ type: 'error', message: `Could not open ${this.name()}: ${String(err)}` });
		}
	}

	private async openReader(): Promise<RangeReader> {
		if (this.uri.scheme === 'file') {
			return openFileReader(this.uri.fsPath);
		}
		// Virtual file systems have no random access; read once, serve from memory.
		return memoryReader(await vscode.workspace.fs.readFile(this.uri));
	}

	private async closeReader(): Promise<void> {
		const reader = this.reader;
		this.reader = undefined;
		try {
			await (await reader)?.close();
		} catch {
			// opening failed, nothing to close
		}
	}

	private name(): string {
		return this.uri.path.split('/').pop() ?? this.uri.path;
	}

	private html(): string {
		const webview = this.panel.webview;
		const asset = (p: string): string => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', p)).toString();
		const nonce = makeNonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} data: blob:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource} data: blob:`,
			`script-src 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource}`,
			`worker-src blob:`,
		].join('; ');
		const config = {
			worker: asset('pdf.worker.js'),
			cMapUrl: asset('pdfjs/cmaps/'),
			standardFontDataUrl: asset('pdfjs/standard_fonts/'),
		};
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${asset('pdfViewer.css')}">
	<title>${escapeHtml(this.name())}</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">window.PDF_VIEWER_CONFIG = ${JSON.stringify(config)};</script>
	<script nonce="${nonce}" type="module" src="${asset('pdfViewer.js')}"></script>
</body>
</html>`;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
