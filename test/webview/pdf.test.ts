import { describe, expect, it } from 'vitest';
import { useHarness } from './harness';

// sample.canvas embeds test/fixtures/paper.pdf as node `pdf`; this drives the
// real pdf.js build (worker started from a blob URL) in headless Chromium.

const harness = useHarness();

describe('PDF nodes', () => {
	it('render the first page and page through the document', async () => {
		const page = await harness.open();
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') {
				errors.push(m.text());
			}
		});
		const node = page.locator('.node[data-id="pdf"]');
		const label = node.locator('.pdf-nav span');

		await expect.poll(() => label.textContent(), { timeout: 15000 }).toMatch(/^1 \/ \d+$/);
		const pages = Number((await label.textContent())!.split(' / ')[1]);

		// Something was actually drawn: the canvas has opaque pixels.
		const drawn = await node.locator('canvas').evaluate((c: HTMLCanvasElement) => {
			const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] !== 0) {
					return true;
				}
			}
			return false;
		});
		expect(drawn).toBe(true);

		if (pages > 1) {
			await node.locator('button[title="Next page"]').click();
			await expect.poll(() => label.textContent()).toBe(`2 / ${pages}`);
		}
		expect(errors).toEqual([]);
	});
});
