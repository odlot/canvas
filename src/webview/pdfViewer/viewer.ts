import type * as PdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, FindState, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PdfHostToWebview, PdfWebviewToHost } from '../../shared/pdfProtocol';
import { ensurePdfWorker } from '../pdfWorker';
import { isFittingScale, NavHistory, parsePageInput, type Position, WheelZoom, ZOOM_PRESETS, zoomChoice } from './controls';

export interface ViewerConfig {
	worker?: string;
	cMapUrl?: string;
	standardFontDataUrl?: string;
	/** WebAssembly image decoders (JPEG 2000, JBIG2). */
	wasmUrl?: string;
	/** ICC colour profiles. */
	iccUrl?: string;
	/** Size of the byte ranges pdf.js asks the host for. */
	rangeChunkSize?: number;
}

/** What survives a reload of the webview (and of the file). */
interface SavedState {
	page?: number;
	scale?: string;
	sidebar?: boolean;
}

export interface ViewerHost {
	postMessage(message: PdfWebviewToHost): void;
	getState(): SavedState | undefined;
	setState(state: SavedState): void;
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

const DEFAULT_CHUNK = 256 * 1024;

/**
 * The PDF viewer page: pdf.js's PDFViewer (lazy page rendering, text and link
 * layers, find) plus a toolbar, an outline sidebar and back/forward history.
 */
export class PdfViewerApp {
	private readonly eventBus = new EventBus();
	private readonly linkService: PDFLinkService;
	private readonly findController: PDFFindController;
	private readonly viewer: PDFViewer;
	private readonly history = new NavHistory();
	private readonly wheelZoom = new WheelZoom();

	private readonly container: HTMLDivElement;
	private readonly sidebar: HTMLElement;
	private readonly outlineEl: HTMLElement;
	private readonly status: HTMLElement;
	private readonly pageInput: HTMLInputElement;
	private readonly pageCount: HTMLElement;
	private readonly zoomSelect: HTMLSelectElement;
	private readonly findInput: HTMLInputElement;
	private readonly findResult: HTMLElement;
	private readonly backButton: HTMLButtonElement;
	private readonly forwardButton: HTMLButtonElement;
	private readonly outlineButton: HTMLButtonElement;

	private generation = -1;
	private transport: PdfjsLib.PDFDataRangeTransport | undefined;
	private loadingTask: PDFDocumentLoadingTask | undefined;
	private doc: PDFDocumentProxy | undefined;
	/** Where to put the view once the next document's pages exist. */
	private restore: SavedState | undefined;
	private state: SavedState;

	constructor(
		private readonly pdfjs: typeof PdfjsLib,
		root: HTMLElement,
		private readonly host: ViewerHost,
		private readonly config: ViewerConfig,
	) {
		this.state = host.getState() ?? {};
		root.classList.add('pdf-app');

		const toolbar = el('div', 'toolbar');
		this.outlineButton = button('☰', 'Toggle outline', () => this.toggleSidebar());
		this.backButton = button('←', 'Back (Alt+←)', () => this.go(this.history.back(this.position())));
		this.forwardButton = button('→', 'Forward (Alt+→)', () => this.go(this.history.forward(this.position())));
		const prev = button('‹', 'Previous page', () => this.viewer.previousPage());
		const next = button('›', 'Next page', () => this.viewer.nextPage());
		this.pageInput = document.createElement('input');
		this.pageInput.className = 'page-input';
		this.pageInput.type = 'text';
		this.pageInput.inputMode = 'numeric';
		this.pageInput.title = 'Page number';
		this.pageInput.addEventListener('change', () => this.goToPageInput());
		this.pageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.goToPageInput();
				this.container.focus();
			}
		});
		this.pageInput.addEventListener('focus', () => this.pageInput.select());
		this.pageCount = el('span', 'page-count');
		const zoomOut = button('−', 'Zoom out (Ctrl+-)', () => this.viewer.decreaseScale());
		const zoomIn = button('+', 'Zoom in (Ctrl+=)', () => this.viewer.increaseScale());
		this.zoomSelect = document.createElement('select');
		this.zoomSelect.className = 'zoom';
		this.zoomSelect.title = 'Zoom';
		for (const p of ZOOM_PRESETS) {
			this.zoomSelect.append(new Option(p.label, p.value));
		}
		this.zoomSelect.append(Object.assign(new Option('', 'custom'), { hidden: true, disabled: true }));
		this.zoomSelect.addEventListener('change', () => {
			this.viewer.currentScaleValue = this.zoomSelect.value;
			this.container.focus();
		});
		this.findInput = document.createElement('input');
		this.findInput.className = 'find-input';
		this.findInput.type = 'search';
		this.findInput.placeholder = 'Find in document';
		this.findInput.title = 'Find (Ctrl+F); Enter for next, Shift+Enter for previous';
		this.findInput.addEventListener('input', () => this.find(''));
		this.findInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.find('again', e.shiftKey);
			} else if (e.key === 'Escape') {
				this.findInput.value = '';
				this.find('');
				this.container.focus();
			}
		});
		const findPrev = button('↑', 'Previous match (Shift+Enter)', () => this.find('again', true));
		const findNext = button('↓', 'Next match (Enter)', () => this.find('again', false));
		this.findResult = el('span', 'find-result');
		toolbar.append(
			group(this.outlineButton, this.backButton, this.forwardButton),
			group(prev, this.pageInput, this.pageCount, next),
			group(zoomOut, this.zoomSelect, zoomIn),
			el('span', 'spacer'),
			group(this.findInput, findPrev, findNext, this.findResult),
		);

		const body = el('div', 'body');
		this.sidebar = el('nav', 'sidebar');
		this.sidebar.setAttribute('aria-label', 'Outline');
		this.outlineEl = el('div', 'outline');
		this.sidebar.append(this.outlineEl);
		const main = el('div', 'main');
		this.container = document.createElement('div');
		this.container.className = 'viewer-container';
		this.container.tabIndex = 0;
		const viewerEl = document.createElement('div');
		viewerEl.className = 'pdfViewer';
		this.container.append(viewerEl);
		this.status = el('div', 'status');
		main.append(this.container, this.status);
		body.append(this.sidebar, main);
		root.append(toolbar, body);

		this.linkService = new PDFLinkService({ eventBus: this.eventBus, externalLinkTarget: LinkTarget.BLANK });
		this.findController = new PDFFindController({ eventBus: this.eventBus, linkService: this.linkService });
		this.viewer = new PDFViewer({
			container: this.container,
			viewer: viewerEl,
			eventBus: this.eventBus,
			linkService: this.linkService,
			findController: this.findController,
			// Links but no forms or annotation editing: this is a viewer.
			annotationMode: this.pdfjs.AnnotationMode.ENABLE,
			annotationEditorMode: this.pdfjs.AnnotationEditorType.DISABLE,
		});
		this.linkService.setViewer(this.viewer);
		this.linkService.setHistory({
			pushCurrentPosition: () => this.history.push(this.position()),
			push: () => this.updateHistoryButtons(),
			pushPage: () => this.updateHistoryButtons(),
			back: () => this.go(this.history.back(this.position())),
			forward: () => this.go(this.history.forward(this.position())),
		} as never);

		this.bindEvents();
		this.setSidebar(false);
		this.updateHistoryButtons();
		this.showStatus('Loading…');
		host.postMessage({ type: 'ready' });
	}

	handleMessage(m: PdfHostToWebview): void {
		switch (m.type) {
			case 'open':
				void this.open(m.generation, m.length, m.initial);
				break;
			case 'range':
				if (m.generation === this.generation) {
					this.transport?.onDataRange(m.begin, m.data);
				}
				break;
			case 'error':
				this.showStatus(m.message, true);
				break;
		}
	}

	private async open(generation: number, length: number, initial: Uint8Array): Promise<void> {
		// A reload (the file changed on disk) keeps the reader where they were.
		this.restore = this.doc ? { page: this.viewer.currentPageNumber, scale: this.viewer.currentScaleValue } : this.state;
		this.generation = generation;
		await this.close();
		await ensurePdfWorker(this.config.worker);

		const host = this.host;
		class HostRangeTransport extends this.pdfjs.PDFDataRangeTransport {
			override requestDataRange(begin: number, end: number): void {
				host.postMessage({ type: 'range', generation, begin, end });
			}
		}
		const transport = (this.transport = new HostRangeTransport(length, initial));
		const task = (this.loadingTask = this.pdfjs.getDocument({
			range: transport,
			rangeChunkSize: this.config.rangeChunkSize ?? DEFAULT_CHUNK,
			// Only fetch what is looked at: no background download of the whole file.
			disableAutoFetch: true,
			disableStream: true,
			cMapUrl: this.config.cMapUrl,
			cMapPacked: true,
			standardFontDataUrl: this.config.standardFontDataUrl,
			wasmUrl: this.config.wasmUrl,
			iccUrl: this.config.iccUrl,
		}));
		task.onPassword = () => {
			this.showStatus('Password-protected PDFs are not supported.', true);
			void task.destroy();
		};
		let doc: PDFDocumentProxy;
		try {
			doc = await task.promise;
		} catch (err) {
			if (generation === this.generation) {
				this.showStatus(`Could not load PDF: ${err instanceof Error ? err.message : String(err)}`, true);
			}
			return;
		}
		if (generation !== this.generation) {
			void task.destroy();
			return;
		}
		this.doc = doc;
		this.history.clear();
		this.updateHistoryButtons();
		this.pageCount.textContent = `/ ${doc.numPages}`;
		this.viewer.setDocument(doc);
		this.linkService.setDocument(doc);
		this.findController.setDocument(doc);
		void this.loadOutline(doc, generation);
	}

	private async close(): Promise<void> {
		const task = this.loadingTask;
		this.loadingTask = undefined;
		this.transport = undefined;
		this.doc = undefined;
		if (task) {
			this.viewer.setDocument(null as never);
			this.linkService.setDocument(null);
			this.findController.setDocument(null as never);
			await task.destroy();
		}
	}

	private bindEvents(): void {
		this.eventBus.on('pagesinit', () => {
			const r = this.restore ?? {};
			this.restore = undefined;
			this.viewer.currentScaleValue = r.scale ?? 'auto';
			if (r.page && r.page > 1) {
				this.viewer.currentPageNumber = Math.min(r.page, this.viewer.pagesCount);
			}
			this.hideStatus();
			this.updatePage();
			if (document.activeElement === document.body) {
				this.container.focus();
			}
		});
		this.eventBus.on('pagechanging', () => this.updatePage());
		this.eventBus.on('scalechanging', ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
			const choice = zoomChoice(scale, presetValue);
			const custom = this.zoomSelect.querySelector<HTMLOptionElement>('option[value="custom"]')!;
			custom.textContent = choice.label;
			this.zoomSelect.value = choice.value;
			this.saveState({ scale: presetValue ?? String(scale) });
		});
		this.eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
			this.showMatches(matchesCount),
		);
		this.eventBus.on(
			'updatefindcontrolstate',
			({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
				if (state === FindState.NOT_FOUND) {
					this.findResult.textContent = 'No results';
					this.findResult.classList.add('not-found');
				} else {
					this.showMatches(matchesCount);
				}
			},
		);

		// Keep fitted zoom levels fitted when the panel or the sidebar resizes.
		let frame = 0;
		new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const value = this.viewer.currentScaleValue;
				if (this.doc && isFittingScale(value)) {
					this.viewer.currentScaleValue = value;
				}
			});
		}).observe(this.container);

		this.container.addEventListener(
			'wheel',
			(e) => {
				if (!e.ctrlKey && !e.metaKey) {
					return;
				}
				e.preventDefault();
				const factor = this.wheelZoom.add(e.deltaY, e.deltaMode, this.viewer.currentScale);
				if (factor !== undefined) {
					this.viewer.updateScale({ scaleFactor: factor, origin: [e.clientX, e.clientY], drawingDelay: 300 });
				}
			},
			{ passive: false },
		);

		window.addEventListener('keydown', (e) => this.onKeyDown(e));
	}

	private onKeyDown(e: KeyboardEvent): void {
		const mod = e.ctrlKey || e.metaKey;
		const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
		if (mod && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			this.findInput.focus();
			this.findInput.select();
		} else if (mod && (e.key === '=' || e.key === '+')) {
			e.preventDefault();
			this.viewer.increaseScale();
		} else if (mod && e.key === '-') {
			e.preventDefault();
			this.viewer.decreaseScale();
		} else if (mod && e.key === '0') {
			e.preventDefault();
			this.viewer.currentScaleValue = 'auto';
		} else if (e.altKey && e.key === 'ArrowLeft') {
			e.preventDefault();
			this.go(this.history.back(this.position()));
		} else if (e.altKey && e.key === 'ArrowRight') {
			e.preventDefault();
			this.go(this.history.forward(this.position()));
		} else if (!inField && !mod && !e.altKey) {
			switch (e.key) {
				case 'Home':
					e.preventDefault();
					this.viewer.currentPageNumber = 1;
					break;
				case 'End':
					e.preventDefault();
					this.viewer.currentPageNumber = this.viewer.pagesCount;
					break;
				case 'n':
				case 'j':
					this.viewer.nextPage();
					break;
				case 'p':
				case 'k':
					this.viewer.previousPage();
					break;
			}
		}
	}

	private find(type: '' | 'again', findPrevious = false): void {
		const query = this.findInput.value;
		if (!query) {
			this.findResult.textContent = '';
			this.findResult.classList.remove('not-found');
		}
		this.eventBus.dispatch('find', {
			source: this,
			type,
			query,
			caseSensitive: false,
			entireWord: false,
			highlightAll: true,
			findPrevious,
			matchDiacritics: false,
		});
	}

	private showMatches({ current, total }: { current: number; total: number }): void {
		this.findResult.classList.remove('not-found');
		this.findResult.textContent = total > 0 ? `${current} of ${total}` : '';
	}

	private goToPageInput(): void {
		const page = parsePageInput(this.pageInput.value, this.viewer.pagesCount);
		if (page !== undefined && page !== this.viewer.currentPageNumber) {
			this.history.push(this.position());
			this.updateHistoryButtons();
			this.viewer.currentPageNumber = page;
		}
		this.updatePage();
	}

	private updatePage(): void {
		const page = this.viewer.currentPageNumber;
		if (document.activeElement !== this.pageInput) {
			this.pageInput.value = String(page);
		}
		this.saveState({ page });
	}

	// --- history ---------------------------------------------------------

	private position(): Position {
		return { page: this.viewer.currentPageNumber, scrollTop: this.container.scrollTop, scale: this.viewer.currentScaleValue };
	}

	private go(to: Position | undefined): void {
		this.updateHistoryButtons();
		if (!to) {
			return;
		}
		if (to.scale === this.viewer.currentScaleValue) {
			this.container.scrollTop = to.scrollTop;
		} else {
			this.viewer.currentPageNumber = Math.min(to.page, this.viewer.pagesCount);
		}
	}

	private updateHistoryButtons(): void {
		this.backButton.disabled = !this.history.canGoBack;
		this.forwardButton.disabled = !this.history.canGoForward;
	}

	// --- outline ---------------------------------------------------------

	private async loadOutline(doc: PDFDocumentProxy, generation: number): Promise<void> {
		this.outlineEl.replaceChildren();
		let outline: OutlineNode[] | null = null;
		try {
			outline = await doc.getOutline();
		} catch (err) {
			console.error(err);
		}
		if (generation !== this.generation) {
			return;
		}
		const has = !!outline?.length;
		this.outlineButton.disabled = !has;
		if (has) {
			this.outlineEl.append(this.outlineList(outline!));
		}
		this.setSidebar(has && (this.state.sidebar ?? window.innerWidth >= 700));
	}

	/** One level of the outline. Children are built when first expanded, so huge outlines stay cheap. */
	private outlineList(items: OutlineNode[]): HTMLElement {
		const ul = el('ul', 'outline-list');
		for (const item of items) {
			const li = el('li', 'outline-item');
			const row = el('div', 'outline-row');
			const toggle = el('button', 'outline-toggle') as HTMLButtonElement;
			const link = document.createElement('a');
			link.className = 'outline-link';
			link.textContent = item.title;
			link.title = item.title;
			if (item.bold) {
				link.style.fontWeight = 'bold';
			}
			if (item.italic) {
				link.style.fontStyle = 'italic';
			}
			if (item.url) {
				link.href = item.url;
				link.target = '_blank';
			} else {
				link.href = '#';
				link.addEventListener('click', (e) => {
					e.preventDefault();
					if (item.dest) {
						void this.linkService.goToDestination(item.dest);
					}
				});
			}
			if (item.items.length) {
				toggle.textContent = '▸';
				toggle.title = 'Expand';
				toggle.addEventListener('click', () => {
					let children = li.querySelector<HTMLElement>(':scope > .outline-list');
					if (!children) {
						children = this.outlineList(item.items);
						li.append(children);
					}
					const open = !li.classList.contains('open');
					li.classList.toggle('open', open);
					toggle.textContent = open ? '▾' : '▸';
					toggle.title = open ? 'Collapse' : 'Expand';
				});
			} else {
				toggle.disabled = true;
				toggle.tabIndex = -1;
			}
			row.append(toggle, link);
			li.append(row);
			ul.append(li);
		}
		return ul;
	}

	private toggleSidebar(): void {
		const open = !this.sidebar.classList.contains('open');
		this.setSidebar(open);
		this.saveState({ sidebar: open });
	}

	private setSidebar(open: boolean): void {
		this.sidebar.classList.toggle('open', open);
		this.outlineButton.classList.toggle('active', open);
	}

	// --- misc ------------------------------------------------------------

	private saveState(patch: SavedState): void {
		this.state = { ...this.state, ...patch };
		this.host.setState(this.state);
	}

	private showStatus(text: string, error = false): void {
		this.status.textContent = text;
		this.status.classList.toggle('error', error);
		this.status.hidden = false;
	}

	private hideStatus(): void {
		this.status.hidden = true;
	}
}

function el(tag: string, className: string): HTMLElement {
	const e = document.createElement(tag);
	e.className = className;
	return e;
}

function button(text: string, title: string, onClick: () => void): HTMLButtonElement {
	const b = document.createElement('button');
	b.type = 'button';
	b.textContent = text;
	b.title = title;
	b.setAttribute('aria-label', title);
	b.addEventListener('click', onClick);
	return b;
}

function group(...children: HTMLElement[]): HTMLElement {
	const g = el('div', 'group');
	g.append(...children);
	return g;
}
