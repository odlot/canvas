import * as assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { onlyFiles } from '../../src/extension/files';

suite('onlyFiles', () => {
	test('keeps files and leaves out folders and missing paths', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'canvas-files-'));
		try {
			writeFileSync(join(dir, 'a.md'), 'a');
			mkdirSync(join(dir, 'sub'));
			const uris = await onlyFiles([join(dir, 'a.md'), join(dir, 'sub'), join(dir, 'missing.md')].map((p) => vscode.Uri.file(p)));
			assert.deepStrictEqual(uris.map((u) => u.fsPath), [join(dir, 'a.md')]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
