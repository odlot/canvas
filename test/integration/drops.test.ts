import * as assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { droppedFiles, importFiles } from '../../src/extension/drops';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const read = async (uri: vscode.Uri): Promise<string> => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));

suite('Dropping files', () => {
	let dir: vscode.Uri;

	setup(() => {
		dir = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'canvas-drop-')));
	});

	teardown(() => {
		rmSync(dir.fsPath, { recursive: true, force: true });
	});

	test('copies files from the OS into the folder', async () => {
		const [uri] = await importFiles(dir, [{ name: 'notes.md', data: bytes('# Hi') }]);
		assert.strictEqual(uri.toString(), vscode.Uri.joinPath(dir, 'notes.md').toString());
		assert.strictEqual(await read(uri), '# Hi');
	});

	test('numbers a name that is taken by a different file', async () => {
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'notes.md'), bytes('old'));
		const [uri] = await importFiles(dir, [{ name: 'notes.md', data: bytes('new') }]);
		assert.strictEqual(uri.toString(), vscode.Uri.joinPath(dir, 'notes 1.md').toString());
		assert.strictEqual(await read(uri), 'new');
		assert.strictEqual(await read(vscode.Uri.joinPath(dir, 'notes.md')), 'old');
	});

	test('reuses an identical file instead of duplicating it', async () => {
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, 'notes.md'), bytes('same'));
		const [uri] = await importFiles(dir, [{ name: 'notes.md', data: bytes('same') }]);
		assert.strictEqual(uri.toString(), vscode.Uri.joinPath(dir, 'notes.md').toString());
		const entries = await vscode.workspace.fs.readDirectory(dir);
		assert.deepStrictEqual(entries.map(([name]) => name), ['notes.md']);
	});

	test('does not write outside the folder', async () => {
		const [uri] = await importFiles(dir, [{ name: '../escape.txt', data: bytes('x') }]);
		assert.strictEqual(uri.toString(), vscode.Uri.joinPath(dir, 'escape.txt').toString());
	});

	test('keeps files dropped from VS Code and leaves out folders, missing files and other schemes', async () => {
		const file = vscode.Uri.joinPath(dir, 'a.md');
		const folder = vscode.Uri.joinPath(dir, 'sub');
		await vscode.workspace.fs.writeFile(file, bytes('a'));
		await vscode.workspace.fs.createDirectory(folder);
		const uris = await droppedFiles(
			[file.toString(), folder.toString(), vscode.Uri.joinPath(dir, 'missing.md').toString(), 'untitled:Untitled-1', '%%%'],
			['file'],
		);
		assert.deepStrictEqual(uris.map((u) => u.toString()), [file.toString()]);
	});
});
