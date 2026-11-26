import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll } from 'vitest';

// Serves the repo and drives dev/harness.html in headless Chromium.

const ROOT = resolve(__dirname, '../..');
const MIME: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
};

export interface Harness {
	/** Open the harness in a new page; `query` is appended to the URL (e.g. `newNoteFormat=markdownFile`). */
	open(query?: string): Promise<Page>;
}

/** Registers beforeAll/afterAll hooks that start a static server and a browser. */
export function useHarness(): Harness {
	let server: Server;
	let browser: Browser;
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

	return {
		async open(query = '') {
			const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
			await page.goto(`${base}/dev/harness.html${query ? `?${query}` : ''}`);
			await page.waitForSelector('.node[data-id="welcome"] .markdown');
			return page;
		},
	};
}

/** Messages the webview posted to the (fake) host. */
export const posted = (page: Page): Promise<{ type: string; [k: string]: unknown }[]> =>
	page.evaluate(() => (window as unknown as { __posted: { type: string }[] }).__posted);

/** Screen point at a fraction of a node's box. */
export async function pointIn(page: Page, id: string, fx = 0.5, fy = 0.5): Promise<{ x: number; y: number }> {
	const box = (await page.locator(`.node[data-id="${id}"]`).boundingBox())!;
	return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
