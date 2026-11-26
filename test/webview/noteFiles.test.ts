import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../src/shared/types';
import { pointIn, posted, useHarness } from './harness';

// The harness host answers `createNoteFiles` with `noteFilesCreated` for path `notes.md`.

const harness = useHarness();
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/sample.canvas'), 'utf8')) as { nodes: CanvasNode[] };

const createRequests = async (page: Page): Promise<unknown[]> =>
	(await posted(page)).filter((m) => m.type === 'createNoteFiles').map((m) => m.notes);

/** The node as stored in the most recent canvas edit the webview sent. */
const lastSaved = (page: Page, id: string): Promise<CanvasNode | undefined> =>
	page.evaluate((id) => {
		const edits = (window as unknown as { __edits: { nodes: CanvasNode[] }[] }).__edits;
		return edits[edits.length - 1]?.nodes.find((n) => n.id === id);
	}, id);

/** Create a note from the toolbar, type into it and finish editing; returns the new node's id. */
async function writeNewNote(page: Page, text: string): Promise<string> {
	await page.click('[data-action="note"]');
	const editor = page.locator('textarea.node-editor');
	await editor.waitFor();
	const id = (await editor.evaluate((el) => el.closest<HTMLElement>('.node')!.dataset.id))!;
	if (text) {
		await page.keyboard.type(text);
	}
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator('textarea.node-editor').count()).toBe(0);
	return id;
}

describe('save notes as Markdown files', () => {
	it('the toolbar button turns the selected note into a file node', async () => {
		const page = await harness.open();
		const button = page.locator('[data-action="to-file"]');
		expect(await button.isDisabled()).toBe(true);
		const before = fixture.nodes.find((n) => n.id === 'welcome')!;

		const p = await pointIn(page, 'welcome');
		await page.mouse.click(p.x, p.y);
		await expect.poll(() => button.isDisabled()).toBe(false);
		await button.click();

		const requests = await createRequests(page);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toEqual([{ nodeId: 'welcome', text: expect.stringContaining('# Welcome to Canvas') }]);
		await expect.poll(() => lastSaved(page, 'welcome')).toMatchObject({ id: 'welcome', type: 'file', file: 'notes.md' });
		const after = (await lastSaved(page, 'welcome'))!;
		expect('text' in after).toBe(false);
		expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
		await expect.poll(() => button.isDisabled()).toBe(true);
	});

	it('the button stays disabled when only non-text nodes are selected', async () => {
		const page = await harness.open();
		const p = await pointIn(page, 'notes');
		await page.mouse.click(p.x, p.y);
		await expect.poll(() => page.locator('.node[data-id="notes"].selected').count()).toBe(1);
		expect(await page.locator('[data-action="to-file"]').isDisabled()).toBe(true);
	});

	it('with newNoteFormat=markdownFile, a new note becomes a file once written', async () => {
		const page = await harness.open('newNoteFormat=markdownFile');
		const id = await writeNewNote(page, '# Fresh idea');

		await expect.poll(() => createRequests(page)).toEqual([[{ nodeId: id, text: '# Fresh idea' }]]);
		await expect.poll(() => lastSaved(page, id)).toMatchObject({ type: 'file', file: 'notes.md' });
	});

	it('with newNoteFormat=markdownFile, an empty new note stays inline', async () => {
		const page = await harness.open('newNoteFormat=markdownFile');
		await writeNewNote(page, '');
		expect(await createRequests(page)).toEqual([]);
	});

	it('by default, new notes stay inline text', async () => {
		const page = await harness.open();
		const id = await writeNewNote(page, '# Fresh idea');

		await expect.poll(() => lastSaved(page, id)).toMatchObject({ type: 'text', text: '# Fresh idea' });
		expect(await createRequests(page)).toEqual([]);
	});
});
