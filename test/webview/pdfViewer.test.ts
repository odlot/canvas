import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makePdf } from './makePdf';
import { serveRepo, type StaticServer } from './server';

// Drives dev/pdf-harness.html, which plays the extension host's side of the
// range protocol, against a generated manual-sized PDF.

const PAGES = 3000;
const big = makePdf({
	pages: PAGES,
	linkToPage: 1234,
	marker: { page: 2800, word: 'zebracorn' },
	outline: [
		{ title: 'Chapter 1', page: 1 },
		{ title: 'Chapter 2', page: 1000, children: [{ title: 'Section 2.1', page: 1100 }] },
		{ title: 'Chapter 3', page: 2000 },
	],
});

let server: StaticServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
	server = await serveRepo({ '/gen/big.pdf': big, '/gen/broken.pdf': Buffer.from('this is not a PDF') });
	browser = await chromium.launch();
});

afterAll(async () => {
	await browser?.close();
	await server?.close();
});

beforeEach(async () => {
	page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
});

async function open(src: string, query = ''): Promise<void> {
	await page.goto(`${server.base}/dev/pdf-harness.html?src=${encodeURIComponent(src)}${query}`);
}

async function openBig(): Promise<void> {
	// Stream in small chunks so the test can tell lazy loading from reading everything.
	await open('/gen/big.pdf', '&chunk=65536');
	await page.waitForSelector('.page[data-page-number="1"] canvas');
}

const pageInput = (): Promise<string> => page.locator('.page-input').inputValue();
const bytesRequested = (): Promise<number> =>
	page.evaluate(() => (window as unknown as { __ranges: [number, number][] }).__ranges.reduce((n, [b, e]) => n + e - b, 0));

/** Whether a page's rendered canvas is inside the scroll viewport. */
const pageOnScreen = (n: number): Promise<boolean> =>
	page.evaluate((n) => {
		const canvas = document.querySelector(`.page[data-page-number="${n}"] canvas`);
		const box = document.querySelector('.viewer-container')!.getBoundingClientRect();
		const r = canvas?.getBoundingClientRect();
		return !!r && r.bottom > box.top && r.top < box.bottom;
	}, n);

describe('PDF viewer', () => {
	it('opens a large PDF without reading or rendering all of it', async () => {
		await openBig();
		expect(await page.locator('.page').count()).toBe(PAGES);
		expect(await page.locator('.page-count').textContent()).toBe(`/ ${PAGES}`);
		expect(await pageInput()).toBe('1');
		// Only the pages near the viewport are drawn…
		expect(await page.locator('.page canvas').count()).toBeLessThan(12);
		// …and only a small part of the file was transferred.
		expect(await bytesRequested()).toBeLessThan(big.length / 4);
	});

	it('sends small files in one message', async () => {
		await open('../test/fixtures/paper.pdf');
		await page.waitForSelector('.page[data-page-number="1"] canvas');
		expect(await bytesRequested()).toBe(0);
	});

	it('jumps to a typed page number', async () => {
		await openBig();
		await page.locator('.page-input').fill('2500');
		await page.locator('.page-input').press('Enter');
		await expect.poll(() => pageOnScreen(2500)).toBe(true);
		expect(await pageInput()).toBe('2500');
		expect(await bytesRequested()).toBeLessThan(big.length / 2);
	});

	it('navigates with the outline, expanding nested entries on demand', async () => {
		await openBig();
		const sidebar = page.locator('.sidebar.open');
		await expect.poll(() => sidebar.count()).toBe(1);
		// Children aren't built until their parent is expanded.
		expect(await sidebar.getByText('Section 2.1').count()).toBe(0);

		await sidebar.getByText('Chapter 3').click();
		await expect.poll(pageInput).toBe('2000');

		await sidebar.locator('.outline-item', { hasText: 'Chapter 2' }).locator('.outline-toggle').click();
		await sidebar.getByText('Section 2.1').click();
		await expect.poll(pageInput).toBe('1100');
	});

	it('hides the outline on request and remembers that', async () => {
		await openBig();
		await expect.poll(() => page.locator('.sidebar.open').count()).toBe(1);
		await page.getByRole('button', { name: 'Toggle outline' }).click();
		expect(await page.locator('.sidebar.open').count()).toBe(0);
		const state = await page.evaluate(() => (window as unknown as { acquireVsCodeApi: () => { getState(): unknown } }).acquireVsCodeApi().getState());
		expect(state).toMatchObject({ sidebar: false });
	});

	it('follows internal links, and Back returns to where you were', async () => {
		await openBig();
		const back = page.getByRole('button', { name: 'Back (Alt+←)' });
		expect(await back.isDisabled()).toBe(true);

		await page.locator('.page[data-page-number="1"] .annotationLayer a').click();
		await expect.poll(pageInput).toBe('1234');

		await back.click();
		await expect.poll(pageInput).toBe('1');
		await page.getByRole('button', { name: 'Forward (Alt+→)' }).click();
		await expect.poll(pageInput).toBe('1234');
	});

	it('finds text on a distant page', { timeout: 90000 }, async () => {
		await openBig();
		await page.locator('.find-input').fill('zebracorn');
		await expect.poll(pageInput, { timeout: 80000 }).toBe('2800');
		await expect.poll(() => page.locator('.page[data-page-number="2800"] .textLayer .highlight').count(), { timeout: 10000 }).toBeGreaterThan(0);
		await expect.poll(() => page.locator('.find-result').textContent(), { timeout: 80000 }).toBe('1 of 1');
	});

	it('reports a search without matches', async () => {
		await open('../test/fixtures/paper.pdf');
		await page.waitForSelector('.page[data-page-number="1"] canvas');
		await page.keyboard.press('Control+f');
		expect(await page.evaluate(() => document.activeElement?.className)).toBe('find-input');
		await page.keyboard.type('no-such-text-anywhere');
		await expect.poll(() => page.locator('.find-result.not-found').textContent()).toBe('No results');
	});

	it('zooms with the toolbar, the zoom menu and ctrl+wheel', async () => {
		await openBig();
		const width = (): Promise<number> => page.locator('.page[data-page-number="1"] .canvasWrapper').evaluate((e) => e.getBoundingClientRect().width);
		const zoom = page.locator('select.zoom');

		await zoom.selectOption('1');
		await expect.poll(width).toBeCloseTo(612 * (96 / 72), -1);

		await page.getByRole('button', { name: 'Zoom in (Ctrl+=)' }).click();
		await expect.poll(() => zoom.locator('option:checked').textContent()).toBe('110%');

		const before = await width();
		const box = (await page.locator('.viewer-container').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -100);
		await page.keyboard.up('Control');
		await expect.poll(width).toBeGreaterThan(before * 1.5);
	});

	it('keeps the page when the file is reloaded', async () => {
		await openBig();
		await page.locator('.page-input').fill('2000');
		await page.locator('.page-input').press('Enter');
		await expect.poll(() => pageOnScreen(2000)).toBe(true);

		await page.evaluate(() => (window as unknown as { __reload: () => Promise<void> }).__reload());

		await expect.poll(() => pageOnScreen(2000)).toBe(true);
		expect(await pageInput()).toBe('2000');
	});

	it('shows an error for a file that is not a PDF', async () => {
		await open('/gen/broken.pdf');
		await expect.poll(() => page.locator('.status.error').textContent()).toMatch(/Could not load PDF/);
	});
});
