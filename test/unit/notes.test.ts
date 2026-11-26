import { describe, expect, it } from 'vitest';
import { normalizeFolder, noteTitle, uniqueNoteName } from '../../src/shared/notes';

describe('noteTitle', () => {
	it.each([
		['# My *great* idea\n\nbody', 'My great idea'],
		['\n\n  plain first line  \nsecond', 'plain first line'],
		['- [ ] buy milk', 'buy milk'],
		['1. step one', 'step one'],
		['> quoted', 'quoted'],
		['See [the docs](https://x.y) and [[Other|alias]]', 'See the docs and alias'],
		['a/b:c?d"e<f>g|h#i^j', 'a b c d e f g h i j'],
		['---\ntitle after rule', 'title after rule'],
		['...hidden...', 'hidden'],
		['', 'Untitled'],
		['   \n## \n', 'Untitled'],
	])('%j → %j', (text, title) => {
		expect(noteTitle(text)).toBe(title);
	});

	it('limits the length', () => {
		expect(noteTitle('x'.repeat(200))).toHaveLength(80);
	});
});

describe('uniqueNoteName', () => {
	it('appends a counter until the name is free', async () => {
		const taken = new Set(['Idea.md', 'Idea 1.md']);
		expect(await uniqueNoteName('Idea', (n) => taken.has(n))).toBe('Idea 2.md');
		expect(await uniqueNoteName('New', async (n) => taken.has(n))).toBe('New.md');
	});
});

describe('normalizeFolder', () => {
	it.each([
		['', ''],
		['notes', 'notes'],
		['/notes/inbox/', 'notes/inbox'],
		['notes\\inbox', 'notes/inbox'],
		['./a/../b', 'a/b'],
	])('%j → %j', (input, out) => {
		expect(normalizeFolder(input)).toBe(out);
	});
});
