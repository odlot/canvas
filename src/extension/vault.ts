import * as os from 'node:os';
import * as vscode from 'vscode';
import type { CanvasConfig, NewNoteFormat } from '../shared/protocol';

/**
 * The vault is the folder canvas `file` paths are relative to and where new
 * note files are written. It comes from the `canvas.vault` setting, else the
 * workspace folder, else the canvas's own folder.
 */
export function vaultUri(resource: vscode.Uri | undefined): vscode.Uri | undefined {
	const folder = (resource && vscode.workspace.getWorkspaceFolder(resource)) ?? vscode.workspace.workspaceFolders?.[0];
	const setting = vscode.workspace.getConfiguration('canvas', resource).get<string>('vault', '').trim();
	if (setting) {
		const expanded = setting === '~' || /^~[\\/]/.test(setting) ? os.homedir() + setting.slice(1) : setting;
		if (expanded.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(expanded)) {
			// Keep the workspace's scheme/authority so remote workspaces resolve on the remote side.
			return folder && folder.uri.scheme !== 'file' ? folder.uri.with({ path: expanded }) : vscode.Uri.file(expanded);
		}
		const relativeTo = folder?.uri ?? canvasDir(resource);
		if (relativeTo) {
			return vscode.Uri.joinPath(relativeTo, expanded);
		}
	}
	return folder?.uri ?? canvasDir(resource);
}

function canvasDir(resource: vscode.Uri | undefined): vscode.Uri | undefined {
	return resource && resource.scheme !== 'untitled' ? vscode.Uri.joinPath(resource, '..') : undefined;
}

/** Vault-relative folder that new note files are written to. */
export function notesFolder(resource: vscode.Uri | undefined): string {
	return vscode.workspace.getConfiguration('canvas', resource).get<string>('notesFolder', '');
}

export function canvasConfig(resource: vscode.Uri | undefined): CanvasConfig {
	const format = vscode.workspace.getConfiguration('canvas', resource).get<NewNoteFormat>('newNoteFormat', 'text');
	const vault = vaultUri(resource);
	return {
		newNoteFormat: format === 'markdownFile' ? 'markdownFile' : 'text',
		vault: vault && {
			name: vault.path.replace(/\/+$/, '').split('/').pop() || vault.path,
			path: vault.scheme === 'file' ? vault.fsPath : vault.toString(),
		},
	};
}

/**
 * `canvas.selectVault`: pick a folder and store it in the `canvas.vault` setting.
 * `resource` is the canvas asking (from its toolbar), used to preselect its current vault.
 */
export async function selectVault(resource?: vscode.Uri): Promise<void> {
	const active = resource ?? vscode.window.activeTextEditor?.document.uri;
	const picked = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		defaultUri: vaultUri(active),
		openLabel: 'Use as Vault',
		title: 'Select the folder where canvas files and notes are stored',
	});
	if (!picked?.[0]) {
		return;
	}
	const uri = picked[0];
	const folder = vscode.workspace.getWorkspaceFolder(uri);
	// Inside the workspace, store a workspace-relative path so the setting travels with the repo.
	const value = folder ? uri.path.slice(folder.uri.path.replace(/\/$/, '').length + 1) : uri.fsPath;
	const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
	await vscode.workspace.getConfiguration('canvas').update('vault', value, target);
	void vscode.window.showInformationMessage(`Canvas vault set to ${value || folder?.name || uri.fsPath}.`);
}
