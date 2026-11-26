import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Drives dev/harness.html with real mouse input. Synthetic `dblclick` events
// would bypass the pointer capture that the viewport takes on pointerdown,
// which is exactly what retargeted double-clicks away from nodes before.

const ROOT = resolve(__dirname, '../..');
const MIME: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
};

let server: Server;
let browser: Browser;
let page: Page;
let base: string;

beforeAll(async () => {
	if (!existsSync(join(ROOT, 'dist/webview.js'))) {
		throw new Error('dist/ is missing: run `npm run test:webview`, which builds first');
	}
	server = createServer((req, res) => {
		const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url!, 'http://x').pathname)));
		if (!path.startsWith(ROOT) || !existsSync(path) || !statSync(path).isFile()) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
		createReadStream(path).pipe(res);
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	browser = await chromium.launch();
});

afterAll(async () => {
	await browser?.close();
	await new Promise((r) => server?.close(r));
});

beforeEach(async () => {
	page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	await page.goto(`${base}/dev/harness.html`);
	await page.waitForSelector('.node[data-id="welcome"] .markdown');
});

const nodeCount = (): Promise<number> => page.locator('.node').count();
const posted = (): Promise<{ type: string }[]> => page.evaluate(() => (window as unknown as { __posted: { type: string }[] }).__posted);

/** Screen point at a fraction of a node's box. */
async function pointIn(id: string, fx = 0.5, fy = 0.5): Promise<{ x: number; y: number }> {
	const box = (await page.locator(`.node[data-id="${id}"]`).boundingBox())!;
	return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

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

	it('opens the URL of a link node', async () => {
		const p = await pointIn('link');
		await page.mouse.dblclick(p.x, p.y);
		await expect.poll(async () => (await posted()).some((m) => m.type === 'openLink')).toBe(true);
	});
});
