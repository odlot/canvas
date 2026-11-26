import { describe, expect, it } from 'vitest';
import { numberedName, safeFileName } from '../../src/shared/fileNames';

describe('safeFileName', () => {
	it('keeps ordinary names', () => {
		expect(safeFileName('Meeting notes.md')).toBe('Meeting notes.md');
	});

	it('drops directories', () => {
		expect(safeFileName('../../etc/passwd')).toBe('passwd');
		expect(safeFileName('C:\\Users\\me\\photo.png')).toBe('photo.png');
	});

	it('replaces characters that file systems reject', () => {
		expect(safeFileName('a:b*c?.txt')).toBe('a_b_c_.txt');
	});

	it('never returns an empty or dot-only name', () => {
		expect(safeFileName('')).toBe('file');
		expect(safeFileName('..')).toBe('file');
		expect(safeFileName(' .hidden ')).toBe('hidden');
	});
});

describe('numberedName', () => {
	it('returns the name itself first', () => {
		expect(numberedName('photo.png', 0)).toBe('photo.png');
	});

	it('numbers before the extension', () => {
		expect(numberedName('photo.png', 2)).toBe('photo 2.png');
		expect(numberedName('archive.tar.gz', 1)).toBe('archive.tar 1.gz');
	});

	it('appends to names without an extension', () => {
		expect(numberedName('Makefile', 1)).toBe('Makefile 1');
	});
});
