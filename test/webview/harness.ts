import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll } from 'vitest';
import { serveRepo, type StaticServer } from './server';

// Serves the repo and drives dev/harness.html in headless Chromium.

export interface Harness {
	/** Open the harness in a new page; `query` is appended to the URL (e.g. `newNoteFormat=markdownFile`). */
	open(query?: string): Promise<Page>;
}

/** Registers beforeAll/afterAll hooks that start a static server and a browser. */
export function useHarness(): Harness {
	let server: StaticServer;
	let browser: Browser;

	beforeAll(async () => {
		server = await serveRepo();
		browser = await chromium.launch();
	});

	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	return {
		async open(query = '') {
			const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
			await page.goto(`${server.base}/dev/harness.html${query ? `?${query}` : ''}`);
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
