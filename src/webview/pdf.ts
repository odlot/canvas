import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ensurePdfWorker } from './pdfWorker';

declare global {
	interface Window {
		CANVAS_PDF_WORKER?: string;
	}
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

function loadDocument(uri: string): Promise<PDFDocumentProxy> {
	let p = docs.get(uri);
	if (!p) {
		p = ensurePdfWorker(window.CANVAS_PDF_WORKER).then(async () => {
			const data = new Uint8Array(await (await fetch(uri)).arrayBuffer());
			return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
		});
		docs.set(uri, p);
		p.catch(() => docs.delete(uri));
	}
	return p;
}

export function forgetPdf(uri: string): void {
	docs.delete(uri);
}

/**
 * A PDF viewer element with page navigation. Renders one page at a time at a
 * resolution matched to the node width.
 */
export class PdfView {
	readonly el: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly label: HTMLElement;
	private page = 1;
	private pages = 0;
	private doc: PDFDocumentProxy | undefined;
	private renderToken = 0;
	private lastWidth = 0;

	constructor(private uri: string) {
		this.el = document.createElement('div');
		this.el.className = 'pdf-view';
		this.canvas = document.createElement('canvas');
		const nav = document.createElement('div');
		nav.className = 'pdf-nav';
		const prev = button('‹', 'Previous page', () => this.go(this.page - 1));
		const next = button('›', 'Next page', () => this.go(this.page + 1));
		this.label = document.createElement('span');
		this.label.textContent = 'Loading…';
		nav.append(prev, this.label, next);
		const scroller = document.createElement('div');
		scroller.className = 'pdf-page';
		scroller.append(this.canvas);
		this.el.append(scroller, nav);
		void this.load();
	}

	private async load(): Promise<void> {
		try {
			this.doc = await loadDocument(this.uri);
			this.pages = this.doc.numPages;
			await this.render();
		} catch (err) {
			this.label.textContent = 'Could not load PDF';
			console.error(err);
		}
	}

	private go(page: number): void {
		if (!this.doc || page < 1 || page > this.pages) {
			return;
		}
		this.page = page;
		void this.render();
	}

	/** Re-render if the node got noticeably wider (keeps text crisp after resizing). */
	resized(width: number): void {
		if (this.doc && Math.abs(width - this.lastWidth) > 40) {
			void this.render();
		}
	}

	private async render(): Promise<void> {
		if (!this.doc) {
			return;
		}
		const token = ++this.renderToken;
		const page = await this.doc.getPage(this.page);
		const width = Math.max(200, this.el.clientWidth || 400);
		this.lastWidth = width;
		const base = page.getViewport({ scale: 1 });
		const scale = (width / base.width) * Math.min(3, (window.devicePixelRatio || 1) * 1.5);
		const viewport = page.getViewport({ scale });
		if (token !== this.renderToken) {
			return;
		}
		this.canvas.width = Math.floor(viewport.width);
		this.canvas.height = Math.floor(viewport.height);
		await page.render({ canvasContext: this.canvas.getContext('2d')!, viewport }).promise;
		this.label.textContent = `${this.page} / ${this.pages}`;
	}
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
	const b = document.createElement('button');
	b.textContent = text;
	b.title = title;
	b.addEventListener('pointerdown', (e) => e.stopPropagation());
	b.addEventListener('dblclick', (e) => e.stopPropagation());
	b.addEventListener('click', (e) => {
		e.stopPropagation();
		onClick();
	});
	return b;
}
