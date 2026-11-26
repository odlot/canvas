import type { Page } from 'playwright';
import { beforeEach, describe, expect, it } from 'vitest';
import { posted, useHarness } from './harness';

// VS Code only lets a drag reach a webview while Shift is held; these tests
// play the events the webview then receives.

const harness = useHarness();
let page: Page;
beforeEach(async () => {
	page = await harness.open();
});

interface DragSpec {
	files?: { name: string; text: string }[];
	uris?: string[];
	shiftKey?: boolean;
}

/** Dispatch a drag event on empty canvas, carrying files from the OS and/or a VS Code uri-list. */
const drag = (type: 'dragover' | 'drop', spec: DragSpec): Promise<void> =>
	page.evaluate(
		({ type, spec }) => {
			const dt = new DataTransfer();
			for (const f of spec.files ?? []) {
				dt.items.add(new File([f.text], f.name));
			}
			if (spec.uris) {
				dt.setData('application/vnd.code.uri-list', spec.uris.join('\r\n'));
			}
			document.querySelector('.viewport')!.dispatchEvent(
				new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 30, clientY: 30, shiftKey: spec.shiftKey ?? true }),
			);
		},
		{ type, spec },
	);

const fileNodes = (): Promise<string[]> =>
	page.evaluate(() => {
		const edits = (window as unknown as { __edits: { nodes: { type: string; file?: string }[] }[] }).__edits;
		return (edits.at(-1)?.nodes ?? []).filter((n) => n.type === 'file').map((n) => n.file!);
	});

describe('dropping files', () => {
	it('sends files from the OS to the host with their contents and adds them as nodes', async () => {
		await drag('drop', { files: [{ name: 'idea.md', text: '# Idea' }, { name: 'photo.png', text: 'PNG' }] });

		await expect
			.poll(async () => {
				const m = ((await posted(page)) as { type: string; files?: { name: string; data: Record<string, number> }[] }[]).find(
					(x) => x.type === 'importFiles',
				);
				return m?.files?.map((f) => [f.name, String.fromCharCode(...Object.values(f.data))]);
			})
			.toEqual([
				['idea.md', '# Idea'],
				['photo.png', 'PNG'],
			]);
		await expect.poll(fileNodes).toEqual(expect.arrayContaining(['idea.md', 'photo.png']));
	});

	it('resolves files dropped from the Explorer by URI instead of copying them', async () => {
		await drag('drop', { uris: ['file:///work/notes.md'], files: [{ name: 'notes.md', text: 'x' }] });

		const messages = await posted(page);
		expect(messages).toContainEqual(expect.objectContaining({ type: 'resolveDrop', uris: ['file:///work/notes.md'] }));
		expect(messages.some((m) => m.type === 'importFiles')).toBe(false);
	});

	it('tells the user to hold Shift when files are dragged over without it', async () => {
		const hint = page.locator('.drop-hint');
		await expect.poll(() => hint.isVisible()).toBe(false);

		await drag('dragover', { files: [{ name: 'a.md', text: 'a' }], shiftKey: false });

		await expect.poll(() => hint.isVisible()).toBe(true);
		expect(await hint.textContent()).toContain('Shift');
	});

	it('shows no hint while Shift is held', async () => {
		await drag('dragover', { files: [{ name: 'a.md', text: 'a' }], shiftKey: true });
		expect(await page.locator('.drop-hint').isVisible()).toBe(false);
	});
});
