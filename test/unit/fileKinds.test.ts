import { describe, expect, it } from 'vitest';
import { basename, codeLanguage, fileExtension, fileKind, sliceMarkdown } from '../../src/shared/fileKinds';
import { isValidColor, resolveColor } from '../../src/shared/colors';

describe('fileKind', () => {
	it.each([
		['notes/a.md', 'markdown'],
		['README.MARKDOWN', 'markdown'],
		['img/photo.JPG', 'image'],
		['diagram.svg', 'image'],
		['paper.pdf', 'pdf'],
		['src/index.ts', 'code'],
		['main.py', 'code'],
		['Dockerfile', 'code'],
		['archive.zip', 'other'],
		['noext', 'other'],
	])('%s → %s', (path, kind) => {
		expect(fileKind(path)).toBe(kind);
	});

	it('maps code languages', () => {
		expect(codeLanguage('a.tsx')).toBe('typescript');
		expect(codeLanguage('x.rs')).toBe('rust');
		expect(codeLanguage('x.unknown')).toBeUndefined();
	});

	it('handles dotfiles and windows paths', () => {
		expect(fileExtension('.gitignore')).toBe('.gitignore');
		expect(basename('C:\\notes\\a.md')).toBe('a.md');
	});
});

describe('sliceMarkdown (file node subpath)', () => {
	const md = ['# Title', 'intro', '## Part A', 'a text', '### Sub', 'sub text', '## Part B', 'b text', '', 'para one', 'line two ^blk'].join('\n');

	it('returns the whole document without a subpath', () => {
		expect(sliceMarkdown(md, undefined)).toBe(md);
	});

	it('returns a heading section including nested headings', () => {
		expect(sliceMarkdown(md, '#Part A')).toBe('## Part A\na text\n### Sub\nsub text');
	});

	it('is case-insensitive on headings', () => {
		expect(sliceMarkdown(md, '#part b').startsWith('## Part B')).toBe(true);
	});

	it('returns a block reference paragraph without the marker', () => {
		expect(sliceMarkdown(md, '#^blk')).toBe('para one\nline two');
	});

	it('falls back to the whole document when not found', () => {
		expect(sliceMarkdown(md, '#Nope')).toBe(md);
	});
});

describe('colors', () => {
	it('resolves presets and hex', () => {
		expect(resolveColor('1')).toMatch(/^#/);
		expect(resolveColor('#123456')).toBe('#123456');
		expect(resolveColor('bogus')).toBeUndefined();
		expect(resolveColor(undefined)).toBeUndefined();
	});

	it('isValidColor', () => {
		expect(isValidColor('6')).toBe(true);
		expect(isValidColor('7')).toBe(false);
		expect(isValidColor(3)).toBe(false);
	});
});
