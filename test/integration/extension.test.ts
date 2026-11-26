import * as assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { openFileBeside } from '../../src/extension/openFile';

const fixture = (name: string): vscode.Uri => vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, name);

async function waitFor<T>(fn: () => T | undefined, timeout = 10000): Promise<T> {
	const start = Date.now();
	for (;;) {
		const v = fn();
		if (v) {
			return v;
		}
		if (Date.now() - start > timeout) {
			throw new Error('timed out');
		}
		await new Promise((r) => setTimeout(r, 100));
	}
}

suite('Canvas extension', () => {
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('registers the New Canvas command', async () => {
		const ext = vscode.extensions.getExtension('odlot-marco-lutz.odlot-canvas');
		assert.ok(ext, 'extension is installed');
		await ext.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('canvas.new'));
	});

	test('opens .canvas files in the canvas custom editor by default', async () => {
		await vscode.commands.executeCommand('vscode.open', fixture('sample.canvas'));
		const tab = await waitFor(() => {
			const t = vscode.window.tabGroups.activeTabGroup.activeTab;
			return t?.input instanceof vscode.TabInputCustom ? t : undefined;
		});
		assert.strictEqual((tab.input as vscode.TabInputCustom).viewType, 'canvas.editor');
	});

	test('opens PDFs in the PDF viewer', async () => {
		await vscode.commands.executeCommand('vscode.openWith', fixture('paper.pdf'), 'canvas.pdf');
		const tab = await waitFor(() => {
			const t = vscode.window.tabGroups.activeTabGroup.activeTab;
			return t?.input instanceof vscode.TabInputCustom ? t : undefined;
		});
		assert.strictEqual((tab.input as vscode.TabInputCustom).viewType, 'canvas.pdf');
		assert.strictEqual((tab.input as vscode.TabInputCustom).uri.toString(), fixture('paper.pdf').toString());
	});

	test('files opened from a canvas go beside it: PDFs in the PDF viewer, others in their usual editor', async () => {
		await openFileBeside(fixture('paper.pdf'));
		const pdfTab = await waitFor(() => {
			const t = vscode.window.tabGroups.activeTabGroup.activeTab;
			return t?.input instanceof vscode.TabInputCustom ? t : undefined;
		});
		assert.strictEqual((pdfTab.input as vscode.TabInputCustom).viewType, 'canvas.pdf');
		assert.strictEqual(pdfTab.isPreview, false);

		await openFileBeside(fixture('notes.md'));
		const mdTab = await waitFor(() => {
			const t = vscode.window.tabGroups.activeTabGroup.activeTab;
			return t?.input instanceof vscode.TabInputText ? t : undefined;
		});
		assert.strictEqual((mdTab.input as vscode.TabInputText).uri.toString(), fixture('notes.md').toString());
	});

	test('Add to Canvas inserts Explorer files into the open canvas', async function () {
		// The first webview of a fresh VS Code can take well over the default timeout to load.
		this.timeout(60000);
		const dir = mkdtempSync(join(tmpdir(), 'canvas-add-'));
		const uri = vscode.Uri.file(join(dir, 'board.canvas'));
		writeFileSync(uri.fsPath, '{\n\t"nodes": [],\n\t"edges": []\n}\n');
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'canvas.editor');
			const doc = await vscode.workspace.openTextDocument(uri);

			await vscode.commands.executeCommand('canvas.addToCanvas', fixture('notes.md'), [fixture('notes.md'), fixture('diagram.svg')]);

			const nodes = await waitFor(() => {
				const n = (JSON.parse(doc.getText()) as { nodes: { type: string; file?: string }[] }).nodes;
				return n.length ? n : undefined;
			}, 50000);
			assert.deepStrictEqual(nodes.map((n) => [n.type, n.file]), [
				['file', 'notes.md'],
				['file', 'diagram.svg'],
			]);
			await vscode.commands.executeCommand('workbench.action.files.revert');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('Add File from Workspace adds the file picked in the quick pick', async function () {
		this.timeout(60000);
		const dir = mkdtempSync(join(tmpdir(), 'canvas-pick-'));
		const uri = vscode.Uri.file(join(dir, 'board.canvas'));
		writeFileSync(uri.fsPath, '{\n\t"nodes": [],\n\t"edges": []\n}\n');
		try {
			await vscode.commands.executeCommand('vscode.openWith', uri, 'canvas.editor');
			const doc = await vscode.workspace.openTextDocument(uri);

			const picked = vscode.commands.executeCommand('canvas.addFileFromWorkspace');
			// Accept the top entry (sorted by path) once the file list has loaded.
			const nodes = await waitFor(() => {
				void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
				const n = (JSON.parse(doc.getText()) as { nodes: { type: string; file?: string }[] }).nodes;
				return n.length ? n : undefined;
			}, 50000);
			await picked;
			assert.deepStrictEqual(nodes.map((n) => [n.type, n.file]), [['file', 'diagram.svg']]);
			await vscode.commands.executeCommand('workbench.action.files.revert');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('external edits to the document keep it valid and undoable', async () => {
		const uri = fixture('sample.canvas');
		await vscode.commands.executeCommand('vscode.openWith', uri, 'canvas.editor');
		const doc = await vscode.workspace.openTextDocument(uri);
		const original = doc.getText();
		const data = JSON.parse(original);
		data.nodes.push({ id: 'it-node', type: 'text', text: 'from test', x: 0, y: 900, width: 200, height: 100 });
		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), JSON.stringify(data, null, '\t'));
		assert.ok(await vscode.workspace.applyEdit(edit));
		assert.ok(doc.getText().includes('it-node'));
		assert.ok(doc.isDirty);
		await vscode.commands.executeCommand('workbench.action.files.revert');
		assert.strictEqual(doc.getText(), original);
	});
});
