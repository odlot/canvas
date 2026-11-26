/** DOM-free logic of the PDF viewer, kept separate so it can be unit tested. */

/** A place in the document to return to. */
export interface Position {
	page: number;
	/** Scroll offset of the viewer, only meaningful at the same `scale`. */
	scrollTop: number;
	scale: string;
}

/**
 * Back/forward through link jumps, like a browser: following a link (or an
 * outline entry) records where you were, `back()` returns there.
 */
export class NavHistory {
	private readonly backStack: Position[] = [];
	private readonly forwardStack: Position[] = [];

	constructor(private readonly limit = 100) {}

	/** Record `from` before jumping somewhere else. */
	push(from: Position): void {
		const last = this.backStack[this.backStack.length - 1];
		if (last && last.page === from.page && last.scrollTop === from.scrollTop && last.scale === from.scale) {
			return;
		}
		this.backStack.push(from);
		if (this.backStack.length > this.limit) {
			this.backStack.shift();
		}
		this.forwardStack.length = 0;
	}

	/** The position to go back to from `current`, or undefined at the start. */
	back(current: Position): Position | undefined {
		const to = this.backStack.pop();
		if (to) {
			this.forwardStack.push(current);
		}
		return to;
	}

	forward(current: Position): Position | undefined {
		const to = this.forwardStack.pop();
		if (to) {
			this.backStack.push(current);
		}
		return to;
	}

	get canGoBack(): boolean {
		return this.backStack.length > 0;
	}

	get canGoForward(): boolean {
		return this.forwardStack.length > 0;
	}

	clear(): void {
		this.backStack.length = 0;
		this.forwardStack.length = 0;
	}
}

/** The page a page-number field asks for, clamped to the document, or undefined if it isn't a number. */
export function parsePageInput(text: string, pageCount: number): number | undefined {
	const n = Number.parseInt(text.trim(), 10);
	if (!Number.isFinite(n) || pageCount < 1) {
		return undefined;
	}
	return Math.min(Math.max(1, n), pageCount);
}

export const ZOOM_PRESETS: readonly { value: string; label: string }[] = [
	{ value: 'auto', label: 'Automatic' },
	{ value: 'page-fit', label: 'Page Fit' },
	{ value: 'page-width', label: 'Page Width' },
	{ value: 'page-actual', label: 'Actual Size' },
	...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` })),
];

/** Whether a scale value adapts to the viewer size (and must be re-applied on resize). */
export function isFittingScale(value: string): boolean {
	return value === 'auto' || value === 'page-fit' || value === 'page-width';
}

/**
 * Which zoom menu entry describes the viewer's scale: the named preset if one
 * is active, the matching percentage, or a custom percentage entry.
 */
export function zoomChoice(scale: number, presetValue: string | undefined): { value: string; label: string; custom: boolean } {
	const named = ZOOM_PRESETS.find((p) => p.value === presetValue);
	if (named) {
		return { ...named, custom: false };
	}
	const pct = ZOOM_PRESETS.find((p) => Number(p.value) === scale);
	if (pct) {
		return { ...pct, custom: false };
	}
	return { value: 'custom', label: `${Math.round(scale * 100)}%`, custom: true };
}

/**
 * Turns ctrl+wheel / trackpad pinch deltas into scale factors. pdf.js rounds
 * scales to whole percent, so tiny pinch steps are accumulated until they
 * change the scale instead of being lost.
 */
export class WheelZoom {
	private pending = 1;

	/**
	 * Feed one wheel event; returns the factor to apply now, or undefined while
	 * the accumulated change is still below one percent.
	 */
	add(deltaY: number, deltaMode: number, currentScale: number): number | undefined {
		// DOM_DELTA_LINE / DOM_DELTA_PAGE → pixels, roughly.
		const px = deltaMode === 1 ? deltaY * 30 : deltaMode === 2 ? deltaY * 300 : deltaY;
		this.pending *= Math.exp(-Math.max(-100, Math.min(100, px)) / 100);
		const next = Math.round(currentScale * this.pending * 100) / 100;
		if (next === Math.round(currentScale * 100) / 100) {
			return undefined;
		}
		const factor = this.pending;
		this.pending = 1;
		return factor;
	}
}
