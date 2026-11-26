import * as vscode from 'vscode';
import { CanvasEditorProvider } from './canvasEditor';
import { selectVault, vaultUri } from './vault';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		CanvasEditorProvider.register(context),
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
		vscode.commands.registerCommand('canvas.selectVault', selectVault),
	);
}

export function deactivate(): void {}
