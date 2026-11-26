import * as vscode from 'vscode';
import { CanvasEditorProvider } from './canvasEditor';
import { selectVault, vaultUri } from './vault';
import { PdfEditorProvider } from './pdfEditor';

export function activate(context: vscode.ExtensionContext): void {
	const canvases = CanvasEditorProvider.register(context);
	context.subscriptions.push(
		PdfEditorProvider.register(context),
		// From the Explorer context menu: `uri` is the clicked file, `uris` the whole selection.
		vscode.commands.registerCommand('canvas.addToCanvas', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
			const picked = uris?.length ? uris : uri ? [uri] : [];
			if (!picked.length) {
				return;
			}
			if (!(await canvases.addFiles(picked))) {
				void vscode.window.showWarningMessage('Canvas: open a canvas first, then add files to it.');
			}
		}),
		vscode.commands.registerCommand('canvas.addFileFromWorkspace', async () => {
			if (!(await canvases.pickAndAddFile())) {
				void vscode.window.showWarningMessage('Canvas: open a canvas first, then add files to it.');
			}
		}),
		vscode.commands.registerCommand('canvas.new', async () => {
			const folder = vaultUri(vscode.window.activeTextEditor?.document.uri);
			const target = await vscode.window.showSaveDialog({
				defaultUri: folder ? vscode.Uri.joinPath(folder, 'Untitled.canvas') : undefined,
				filters: { Canvas: ['canvas'] },
				saveLabel: 'Create Canvas',
			});
			if (!target) {
				return;
			}
			await vscode.workspace.fs.writeFile(target, new TextEncoder().encode('{\n\t"nodes": [],\n\t"edges": []\n}\n'));
			await vscode.commands.executeCommand('vscode.openWith', target, CanvasEditorProvider.viewType);
		}),
		vscode.commands.registerCommand('canvas.selectVault', (resource?: unknown) => selectVault(resource instanceof vscode.Uri ? resource : undefined)),
	);
}

export function deactivate(): void {}
