import type { Page } from 'playwright';
import { beforeEach, describe, expect, it } from 'vitest';
import { pointIn as pointInPage, posted as postedBy, useHarness } from './harness';

// Drives dev/harness.html with real mouse input. Synthetic `dblclick` events
// would bypass the pointer capture that the viewport takes on pointerdown,
// which is exactly what retargeted double-clicks away from nodes before.

const harness = useHarness();
let page: Page;

beforeEach(async () => {
	page = await harness.open();
});

const nodeCount = (): Promise<number> => page.locator('.node').count();
const posted = (): ReturnType<typeof postedBy> => postedBy(page);
const pointIn = (id: string, fx?: number, fy?: number): ReturnType<typeof pointInPage> => pointInPage(page, id, fx, fy);

/** Id of the innermost node under a screen point, or undefined for empty canvas. */
const nodeAt = (p: { x: number; y: number }): Promise<string | undefined> =>
	page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest<HTMLElement>('.node')?.dataset.id, p);

describe('double-click', () => {
	it('edits the Markdown note under the cursor instead of creating one', async () => {
		const before = await nodeCount();
		const p = await pointIn('welcome');
		expect(await nodeAt(p)).toBe('welcome');

		await page.mouse.dblclick(p.x, p.y);

		await expect.poll(() => page.locator('.node[data-id="welcome"] textarea.node-editor').count()).toBe(1);
		expect(await page.locator('textarea.node-editor').inputValue()).toContain('# Welcome to Canvas');
		expect(await nodeCount()).toBe(before);
	});

	it('edits a note that is already selected', async () => {
		const p = await pointIn('welcome');
		await page.mouse.click(p.x, p.y);
		await expect.poll(() => page.locator('.node[data-id="welcome"].selected').count()).toBe(1);

		await page.mouse.dblclick(p.x, p.y);

		await expect.poll(() => page.locator('.node[data-id="welcome"] textarea.node-editor').count()).toBe(1);
	});

	it('does nothing on empty canvas', async () => {
		const before = await nodeCount();
		const p = { x: 20, y: 20 };
		expect(await nodeAt(p)).toBeUndefined();

		await page.mouse.dblclick(p.x, p.y);

		expect(await nodeCount()).toBe(before);
		expect(await page.locator('textarea.node-editor').count()).toBe(0);
		expect((await posted()).filter((m) => m.type === 'edit')).toEqual([]);
	});

	it('does nothing inside the body of a group', async () => {
		const before = await nodeCount();
		// Bottom-right of "Ideas", clear of its child nodes.
		const p = await pointIn('group-ideas', 0.9, 0.9);
		expect(await nodeAt(p)).toBe('group-ideas');

		await page.mouse.dblclick(p.x, p.y);

		expect(await nodeCount()).toBe(before);
		expect(await page.locator('textarea.node-editor, input').count()).toBe(0);
		expect((await posted()).filter((m) => m.type === 'edit')).toEqual([]);
	});

	it('opens the file of a file node', async () => {
		const p = await pointIn('notes');
		await page.mouse.dblclick(p.x, p.y);
		await expect.poll(posted).toContainEqual({ type: 'openFile', path: 'notes.md', subpath: undefined });
	});

	it('opens a PDF file node (the host shows it in the PDF viewer)', async () => {
		await page.waitForSelector('.node[data-id="pdf"] .pdf-page canvas');
		const p = await pointIn('pdf');
		await page.mouse.dblclick(p.x, p.y);
		await expect.poll(posted).toContainEqual({ type: 'openFile', path: 'paper.pdf', subpath: undefined });
	});

	it('opens the URL of a link node', async () => {
		const p = await pointIn('link');
		await page.mouse.dblclick(p.x, p.y);
		await expect.poll(async () => (await posted()).some((m) => m.type === 'openLink')).toBe(true);
	});
});
