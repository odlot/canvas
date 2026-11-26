import * as assert from 'node:assert';
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
