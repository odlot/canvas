import * as assert from 'node:assert';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { canvasConfig, vaultUri } from '../../src/extension/vault';

const root = (): vscode.Uri => vscode.workspace.workspaceFolders![0].uri;
const canvas = (): vscode.Uri => vscode.Uri.joinPath(root(), 'sample.canvas');
const setVault = (value: string | undefined): Thenable<void> =>
	vscode.workspace.getConfiguration('canvas').update('vault', value, vscode.ConfigurationTarget.Global);

suite('Vault', () => {
	teardown(async () => {
		await setVault(undefined);
	});

	test('registers the Select Vault Folder command', async () => {
		await vscode.extensions.getExtension('odlot-marco-lutz.odlot-canvas')!.activate();
		assert.ok((await vscode.commands.getCommands(true)).includes('canvas.selectVault'));
	});

	test('defaults to the workspace folder', () => {
		assert.strictEqual(vaultUri(canvas())?.toString(), root().toString());
	});

	test('resolves a relative setting against the workspace folder', async () => {
		await setVault('notes/inbox');
		assert.strictEqual(vaultUri(canvas())?.toString(), vscode.Uri.joinPath(root(), 'notes/inbox').toString());
	});

	test('accepts absolute and ~ paths', async () => {
		const abs = vscode.Uri.file(os.tmpdir());
		await setVault(abs.fsPath);
		assert.strictEqual(vaultUri(canvas())?.fsPath, abs.fsPath);
		await setVault('~/Vault');
		assert.strictEqual(vaultUri(canvas())?.fsPath, vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), 'Vault').fsPath);
	});

	test('reports the vault name and path for the toolbar', async () => {
		await setVault('notes/inbox');
		const { vault } = canvasConfig(canvas());
		assert.strictEqual(vault?.name, 'inbox');
		assert.strictEqual(vault?.path, vscode.Uri.joinPath(root(), 'notes/inbox').fsPath);
	});
});
