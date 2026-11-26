import { describe, expect, it } from 'vitest';
import { pickerEntries } from '../../src/shared/filePicker';

describe('pickerEntries', () => {
	it('labels each file by name and describes it by folder', () => {
		expect(pickerEntries(['docs/guide/intro.md', 'README.md'])).toEqual([
			{ label: 'intro.md', description: 'docs/guide', path: 'docs/guide/intro.md' },
			{ label: 'README.md', description: '', path: 'README.md' },
		]);
	});

	it('sorts by path, ignoring case and ordering numbers naturally', () => {
		const paths = pickerEntries(['b.md', 'A.md', 'notes/img10.png', 'notes/img2.png']).map((e) => e.path);
		expect(paths).toEqual(['A.md', 'b.md', 'notes/img2.png', 'notes/img10.png']);
	});

	it('leaves out excluded paths', () => {
		expect(pickerEntries(['board.canvas', 'notes.md'], ['board.canvas']).map((e) => e.path)).toEqual(['notes.md']);
	});

	it('uses forward slashes for Windows paths', () => {
		expect(pickerEntries(['docs\\a.md'], ['docs\\b.md'])).toEqual([{ label: 'a.md', description: 'docs', path: 'docs/a.md' }]);
	});
});
