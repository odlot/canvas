import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clampRange, memoryReader, openFileReader } from '../../src/extension/rangeReader';
import { INITIAL_BYTES, initialLength, WHOLE_FILE_BYTES } from '../../src/shared/pdfProtocol';
import { isFittingScale, NavHistory, parsePageInput, WheelZoom, zoomChoice } from '../../src/webview/pdfViewer/controls';

const pos = (page: number, scrollTop = page * 100, scale = 'auto') => ({ page, scrollTop, scale });

describe('NavHistory', () => {
	it('goes back and forward through recorded jumps', () => {
		const h = new NavHistory();
		expect(h.canGoBack).toBe(false);
		h.push(pos(1));
		h.push(pos(50));
		expect(h.back(pos(900))).toEqual(pos(50));
		expect(h.back(pos(50))).toEqual(pos(1));
		expect(h.back(pos(1))).toBeUndefined();
		expect(h.forward(pos(1))).toEqual(pos(50));
		expect(h.forward(pos(50))).toEqual(pos(900));
		expect(h.canGoForward).toBe(false);
	});

	it('drops the forward stack on a new jump', () => {
		const h = new NavHistory();
		h.push(pos(1));
		h.back(pos(2));
		expect(h.canGoForward).toBe(true);
		h.push(pos(1));
		expect(h.canGoForward).toBe(false);
	});

	it('ignores repeated pushes of the same position and caps its size', () => {
		const h = new NavHistory(3);
		h.push(pos(1));
		h.push(pos(1));
		h.back(pos(5));
		expect(h.canGoBack).toBe(false);
		for (let i = 1; i <= 5; i++) {
			h.push(pos(i));
		}
		expect([h.back(pos(9)), h.back(pos(9)), h.back(pos(9)), h.back(pos(9))].map((p) => p?.page)).toEqual([5, 4, 3, undefined]);
	});

	it('clears both directions', () => {
		const h = new NavHistory();
		h.push(pos(1));
		h.push(pos(2));
		h.back(pos(3));
		h.clear();
		expect(h.canGoBack || h.canGoForward).toBe(false);
	});
});

describe('parsePageInput', () => {
	it.each([
		['12', 100, 12],
		[' 7 ', 100, 7],
		['0', 100, 1],
		['-3', 100, 1],
		['5000', 100, 100],
		['abc', 100, undefined],
		['', 100, undefined],
		['3', 0, undefined],
	])('%j of %d pages → %s', (text, count, page) => {
		expect(parsePageInput(text, count)).toBe(page);
	});
});

describe('zoom', () => {
	it('names presets, matches percentages and falls back to a custom entry', () => {
		expect(zoomChoice(1.37, 'page-width')).toEqual({ value: 'page-width', label: 'Page Width', custom: false });
		expect(zoomChoice(1.5, undefined)).toEqual({ value: '1.5', label: '150%', custom: false });
		expect(zoomChoice(1.1, undefined)).toEqual({ value: 'custom', label: '110%', custom: true });
	});

	it('knows which scales follow the viewer size', () => {
		expect(['auto', 'page-fit', 'page-width'].every(isFittingScale)).toBe(true);
		expect(isFittingScale('page-actual') || isFittingScale('1.5')).toBe(false);
	});

	it('accumulates small pinch steps until they change the scale', () => {
		const z = new WheelZoom();
		// 0.2px of pinch is far below 1% at scale 1.
		expect(z.add(-0.2, 0, 1)).toBeUndefined();
		expect(z.add(-0.2, 0, 1)).toBeUndefined();
		const f = z.add(-1, 0, 1);
		expect(f).toBeGreaterThan(1.01);
		expect(f).toBeCloseTo(Math.exp(1.4 / 100), 6);
	});

	it('zooms out on scroll down, in on scroll up, and converts line deltas', () => {
		expect(new WheelZoom().add(50, 0, 1)!).toBeLessThan(1);
		expect(new WheelZoom().add(-50, 0, 1)!).toBeGreaterThan(1);
		expect(new WheelZoom().add(-1, 1, 1)).toBeCloseTo(Math.exp(0.3), 6);
		// A single huge delta is clamped so one notch can't zoom wildly.
		expect(new WheelZoom().add(-10000, 0, 1)).toBeCloseTo(Math.E, 6);
	});
});

describe('initialLength', () => {
	it('sends small files whole and only a first slice of large ones', () => {
		expect(initialLength(1000)).toBe(1000);
		expect(initialLength(WHOLE_FILE_BYTES)).toBe(WHOLE_FILE_BYTES);
		expect(initialLength(WHOLE_FILE_BYTES + 1)).toBe(INITIAL_BYTES);
	});
});

describe('range readers', () => {
	const dir = mkdtempSync(join(tmpdir(), 'canvas-range-'));
	const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
	const path = join(dir, 'f.bin');
	writeFileSync(path, bytes);
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('clamps ranges to the file', () => {
		expect(clampRange(-5, 10, 100)).toEqual([0, 10]);
		expect(clampRange(90, 200, 100)).toEqual([90, 100]);
		expect(clampRange(50, 20, 100)).toEqual([50, 50]);
		expect(clampRange(500, 600, 100)).toEqual([100, 100]);
	});

	it('reads exact ranges from disk', async () => {
		const r = await openFileReader(path);
		try {
			expect(r.length).toBe(1000);
			expect(await r.read(10, 20)).toEqual(bytes.slice(10, 20));
			expect(await r.read(990, 2000)).toEqual(bytes.slice(990));
			expect((await r.read(0, 1000)).length).toBe(1000);
		} finally {
			await r.close();
		}
	});

	it('fails for a missing file', async () => {
		await expect(openFileReader(join(dir, 'missing.pdf'))).rejects.toThrow();
	});

	it('serves ranges from memory', async () => {
		const r = memoryReader(bytes);
		expect(r.length).toBe(1000);
		expect(await r.read(995, 1005)).toEqual(bytes.slice(995));
	});
});
