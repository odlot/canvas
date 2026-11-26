import { PRESET_COLORS, resolveColor } from '../shared/colors';
import { basename, codeLanguage, fileKind, sliceMarkdown } from '../shared/fileKinds';
import {
	arrowHead,
	bezierPath,
	bezierPoint,
	boundingBox,
	controlPoints,
	edgeGeometry,
	fitViewport,
	intersects,
	nearestSide,
	nodeAt,
	rectFromPoints,
	screenToWorld,
	sideAnchor,
	sideNormal,
	zoomAt,
	type Point,
	type Viewport,
} from '../shared/geometry';
import {
	addEdge,
	addNode,
	allIds,
	duplicate,
	findNode,
	generateId,
	moveNodes,
	removeElements,
	resizeNode,
	textToFileNode,
	updateEdge,
	updateNode,
	withGroupChildren,
} from '../shared/operations';
import type { CanvasConfig, HostToWebview, ResolvedFile, WebviewToHost } from '../shared/protocol';
import { SIDES, type Canvas, type CanvasColor, type CanvasNode, type FileNode, type Side } from '../shared/types';
import { parseCanvas, type ValidationIssue } from '../shared/validate';
import { icons } from './icons';
import { indentEdit } from './indent';
import { escapeHtml, highlight, renderMarkdown } from './markdown';
import { PdfView } from './pdf';

export interface HostApi {
	postMessage(message: WebviewToHost): void;
	getState(): unknown;
	setState(state: unknown): void;
}

interface NodeView {
	el: HTMLElement;
	content: HTMLElement;
	label: HTMLElement;
	key: string;
	pdf?: PdfView;
}

interface EdgeView {
	group: SVGElement;
	hit: SVGElement;
	path: SVGElement;
	head: SVGElement;
	tail: SVGElement;
	label: HTMLElement;
}

type Gesture =
	| { kind: 'pan'; start: Point; view: Viewport; moved: boolean; clearOnClick: boolean }
	| { kind: 'move'; start: Point; base: Canvas; ids: Set<string>; moved: boolean; nodeId: string; additive: boolean; wasSelected: boolean }
	| { kind: 'resize'; start: Point; base: Canvas; id: string; width: number; height: number }
	| { kind: 'connect'; from: string; side: Side; cursor: Point }
	| { kind: 'box'; start: Point; current: Point; base: Set<string> };

const DRAG_THRESHOLD = 3;
const ARROW = 12;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Default sizes for new nodes, by kind. */
const SIZES: Record<string, [number, number]> = {
	text: [260, 140],
	markdown: [400, 400],
	code: [480, 300],
	image: [400, 300],
	pdf: [420, 560],
	other: [300, 80],
	link: [340, 110],
};

export class CanvasApp {
	private canvas: Canvas = { nodes: [], edges: [] };
	private view: Viewport = { x: 0, y: 0, zoom: 1 };
	private readonly selNodes = new Set<string>();
	private readonly selEdges = new Set<string>();
	private readonly files = new Map<string, { file: ResolvedFile; version: number }>();
	private readonly requested = new Set<string>();
	private readonly views = new Map<string, NodeView>();
	private readonly edgeViews = new Map<string, EdgeView>();
	private readonly pendingEdge = svgEl('path', { class: 'edge-path pending', d: '' });
	/** Nodes created from image files whose height should follow the image's aspect ratio once loaded. */
	private readonly fitImage = new Set<string>();
	private config: CanvasConfig = { newNoteFormat: 'text' };
	/** Notes created in this session that become Markdown files on their first edit, if `newNoteFormat` says so. */
	private readonly newNotes = new Set<string>();
	private editing: string | undefined;
	private gesture: Gesture | undefined;
	private spaceDown = false;
	private loaded = false;
	private readonly = true;
	private rafPending = false;
	private zoomSettleTimer: ReturnType<typeof setTimeout> | undefined;

	// DOM
	private readonly root: HTMLElement;
	private readonly viewportEl: HTMLElement;
	private readonly world: HTMLElement;
	private readonly groupLayer: HTMLElement;
	private readonly nodeLayer: HTMLElement;
	private readonly edgeSvg: SVGSVGElement;
	private readonly labelLayer: HTMLElement;
	private readonly boxEl: HTMLElement;
	private readonly zoomLabel: HTMLElement;
	private readonly colorButton: HTMLButtonElement;
	private readonly deleteButton: HTMLButtonElement;
	private readonly toFileButton: HTMLButtonElement;
	private readonly vaultButton: HTMLButtonElement;
	private readonly popover: HTMLElement;
	private readonly banner: HTMLElement;
	private readonly errorPanel: HTMLElement;
	private readonly emptyHint: HTMLElement;

	constructor(
		mount: HTMLElement,
		private readonly host: HostApi,
	) {
		this.root = mount;
		this.root.classList.add('canvas-root');
		this.root.innerHTML = /* html */ `
			<div class="viewport" tabindex="0">
				<div class="world">
					<div class="layer groups"></div>
					<svg class="edges" xmlns="${SVG_NS}"></svg>
					<div class="layer nodes"></div>
					<div class="layer labels"></div>
				</div>
				<div class="box" hidden></div>
				<div class="empty-hint" hidden>Add a note from the toolbar · drop files with <kbd>Shift</kbd> held</div>
			</div>
			<div class="toolbar" role="toolbar">
				<button data-action="vault" class="vault-label">${icons.folder}<span></span></button>
				<span class="sep"></span>
				<button data-action="note" title="Add note">${icons.note}<span>Note</span></button>
				<button data-action="file" title="Add file from disk">${icons.file}<span>File</span></button>
				<button data-action="link" title="Add web link">${icons.link}<span>Link</span></button>
				<button data-action="group" title="Add group (around selection)">${icons.group}<span>Group</span></button>
				<span class="sep"></span>
				<button data-action="to-file" title="Save as Markdown file: move selected notes into files in the vault" disabled>${icons.toFile}</button>
				<button data-action="color" title="Color selection" disabled>${icons.color}</button>
				<button data-action="delete" title="Delete selection (Del)" disabled>${icons.trash}</button>
				<span class="sep"></span>
				<button data-action="zoom-out" title="Zoom out (-)">${icons.minus}</button>
				<button data-action="zoom-reset" class="zoom-label" title="Reset zoom (Shift+0)">100%</button>
				<button data-action="zoom-in" title="Zoom in (+)">${icons.plus}</button>
				<button data-action="fit" title="Zoom to fit (Shift+1)">${icons.fit}</button>
			</div>
			<div class="popover" hidden></div>
			<div class="banner" hidden></div>
			<div class="error-panel" hidden></div>
		`;
		const q = <T extends Element>(sel: string): T => this.root.querySelector(sel) as T;
		this.viewportEl = q('.viewport');
		this.world = q('.world');
		this.groupLayer = q('.layer.groups');
		this.nodeLayer = q('.layer.nodes');
		this.edgeSvg = q('svg.edges');
		this.labelLayer = q('.layer.labels');
		this.boxEl = q('.box');
		this.zoomLabel = q('.zoom-label');
		this.colorButton = q('[data-action="color"]');
		this.deleteButton = q('[data-action="delete"]');
		this.toFileButton = q('[data-action="to-file"]');
		this.vaultButton = q('[data-action="vault"]');
		this.updateVault();
		this.popover = q('.popover');
		this.banner = q('.banner');
		this.errorPanel = q('.error-panel');
		this.emptyHint = q('.empty-hint');
		this.edgeSvg.append(this.pendingEdge);

		this.bindEvents();
		const state = host.getState() as { view?: Viewport } | undefined;
		if (state?.view) {
			this.view = state.view;
		}
		host.postMessage({ type: 'ready' });
	}

	// ======================================================================
	// Host messages
	// ======================================================================

	handleMessage(msg: HostToWebview): void {
		switch (msg.type) {
			case 'load':
				this.onLoad(msg.canvas, msg.issues);
				break;
			case 'file': {
				const prev = this.files.get(msg.file.path);
				this.files.set(msg.file.path, { file: msg.file, version: (prev?.version ?? 0) + 1 });
				this.render();
				break;
			}
			case 'insertFiles':
				this.insertFiles(msg.paths, msg.at);
				break;
			case 'config':
				this.config = msg.config;
				this.updateVault();
				break;
			case 'resetFiles':
				this.files.clear();
				this.requested.clear();
				for (const v of this.views.values()) {
					v.key = '';
				}
				this.render();
				break;
			case 'noteFilesCreated': {
				let next = this.canvas;
				for (const { nodeId, path } of msg.files) {
					next = textToFileNode(next, nodeId, path);
					if (this.editing === nodeId) {
						this.editing = undefined;
					}
				}
				this.commit(next);
				break;
			}
		}
	}

	private onLoad(canvas: Canvas | undefined, issues: ValidationIssue[]): void {
		this.gesture = undefined;
		this.boxEl.hidden = true;
		if (!canvas) {
			this.readonly = true;
			this.showErrors(issues);
			return;
		}
		this.errorPanel.hidden = true;
		this.readonly = false;
		this.canvas = canvas;
		for (const id of [...this.selNodes]) {
			if (!findNode(canvas, id)) {
				this.selNodes.delete(id);
			}
		}
		for (const id of [...this.selEdges]) {
			if (!canvas.edges.some((e) => e.id === id)) {
				this.selEdges.delete(id);
			}
		}
		if (this.editing && !findNode(canvas, this.editing)) {
			this.editing = undefined;
		}
		const warnings = issues.filter((i) => i.severity === 'warning');
		if (warnings.length) {
			this.showBanner(`${warnings.length} spec warning${warnings.length > 1 ? 's' : ''}: ${warnings[0].path} ${warnings[0].message}`);
		}
		if (!this.loaded) {
			this.loaded = true;
			if (!(this.host.getState() as { view?: Viewport } | undefined)?.view) {
				this.fit();
				return;
			}
		}
		this.render();
	}

	private showErrors(issues: ValidationIssue[]): void {
		const errors = issues.filter((i) => i.severity === 'error');
		this.errorPanel.innerHTML = `
			<h2>This file is not a valid JSON Canvas</h2>
			<p>Fix the problems below in the text editor; the canvas reloads automatically.</p>
			<ul>${errors
				.slice(0, 50)
				.map((i) => `<li><code>${escapeHtml(i.path || '(root)')}</code> ${escapeHtml(i.message)}</li>`)
				.join('')}</ul>
			<button class="primary" data-action="open-text">Open in Text Editor</button>`;
		this.errorPanel.hidden = false;
		this.errorPanel.querySelector('button')!.addEventListener('click', () => this.host.postMessage({ type: 'openAsText' }));
	}

	private showBanner(text: string): void {
		this.banner.textContent = text;
		const close = document.createElement('button');
		close.textContent = '×';
		close.title = 'Dismiss';
		close.addEventListener('click', () => (this.banner.hidden = true));
		this.banner.append(close);
		this.banner.hidden = false;
	}

	/** Apply a new canvas locally and persist it to the document. */
	private commit(next: Canvas): void {
		if (this.readonly) {
			return;
		}
		this.canvas = next;
		this.render();
		this.host.postMessage({ type: 'edit', canvas: next });
	}

	// ======================================================================
	// Rendering
	// ======================================================================

	private scheduleRender(): void {
		if (this.rafPending) {
			return;
		}
		this.rafPending = true;
		requestAnimationFrame(() => {
			this.rafPending = false;
			this.render();
		});
	}

	render(): void {
		const { x, y, zoom } = this.view;
		// Whole-pixel offsets keep text from landing on subpixel positions.
		this.world.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${zoom})`;
		this.root.style.setProperty('--zoom', String(zoom));
		this.root.style.setProperty('--inv-zoom', String(1 / zoom));
		let grid = 24 * zoom;
		while (grid < 12) {
			grid *= 4;
		}
		this.viewportEl.style.backgroundSize = `${grid}px ${grid}px`;
		this.viewportEl.style.backgroundPosition = `${x}px ${y}px`;
		this.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
		this.emptyHint.hidden = this.canvas.nodes.length > 0 || this.readonly;

		this.renderNodes();
		this.renderEdges();
		this.updateToolbar();
		this.host.setState({ view: this.view });
	}

	private renderNodes(): void {
		const seen = new Set<string>();
		let gi = 0;
		let ni = 0;
		for (const node of this.canvas.nodes) {
			seen.add(node.id);
			const v = this.views.get(node.id) ?? this.createView(node);
			const layer = node.type === 'group' ? this.groupLayer : this.nodeLayer;
			const index = node.type === 'group' ? gi++ : ni++;
			if (layer.children[index] !== v.el) {
				layer.insertBefore(v.el, layer.children[index] ?? null);
			}
			this.updateView(node, v);
		}
		for (const [id, v] of this.views) {
			if (!seen.has(id)) {
				v.el.remove();
				this.views.delete(id);
			}
		}
	}

	private createView(node: CanvasNode): NodeView {
		const el = document.createElement('div');
		el.className = 'node';
		el.dataset.id = node.id;
		const label = document.createElement('div');
		label.className = 'node-label';
		const content = document.createElement('div');
		content.className = 'node-content';
		el.append(label, content);
		for (const side of SIDES) {
			const h = document.createElement('div');
			h.className = 'handle';
			h.dataset.side = side;
			h.title = 'Drag to connect';
			el.append(h);
		}
		const resize = document.createElement('div');
		resize.className = 'resize';
		el.append(resize);
		const v: NodeView = { el, content, label, key: '' };
		this.views.set(node.id, v);
		return v;
	}

	private updateView(node: CanvasNode, v: NodeView): void {
		const s = v.el.style;
		s.left = `${node.x}px`;
		s.top = `${node.y}px`;
		s.width = `${node.width}px`;
		s.height = `${node.height}px`;
		const color = resolveColor(node.color);
		if (color) {
			s.setProperty('--node-color', color);
		} else {
			s.removeProperty('--node-color');
		}
		v.el.className = `node node-${node.type}`;
		v.el.classList.toggle('colored', !!color);
		v.el.classList.toggle('selected', this.selNodes.has(node.id));
		v.el.classList.toggle('editing', this.editing === node.id);

		if (this.editing === node.id) {
			return;
		}
		const key = this.contentKey(node);
		if (key !== v.key) {
			v.key = key;
			this.renderContent(node, v);
		} else {
			v.pdf?.resized(node.width);
		}
	}

	/** Everything that affects a node's inner content (not its geometry). */
	private contentKey(node: CanvasNode): string {
		switch (node.type) {
			case 'text':
				return `t:${node.text}`;
			case 'file':
				return `f:${node.file}:${node.subpath ?? ''}:${this.files.get(node.file)?.version ?? 0}`;
			case 'link':
				return `l:${node.url}`;
			case 'group':
				return `g:${node.label ?? ''}:${node.background ?? ''}:${node.backgroundStyle ?? ''}:${node.background ? (this.files.get(node.background)?.version ?? 0) : ''}`;
		}
	}

	private resolved(path: string): ResolvedFile | undefined {
		const entry = this.files.get(path);
		if (!entry && !this.requested.has(path)) {
			this.requested.add(path);
			this.host.postMessage({ type: 'requestFile', path });
		}
		return entry?.file;
	}

	private renderContent(node: CanvasNode, v: NodeView): void {
		v.pdf = undefined;
		v.label.textContent = '';
		v.content.replaceChildren();
		v.content.className = 'node-content';
		v.el.style.removeProperty('--group-bg');
		switch (node.type) {
			case 'text':
				v.content.classList.add('markdown');
				v.content.innerHTML = renderMarkdown(node.text);
				break;
			case 'link': {
				let host = node.url;
				try {
					host = new URL(node.url).hostname;
				} catch {
					// keep raw url
				}
				v.content.classList.add('link-card');
				v.content.innerHTML = `<div class="link-host">${icons.link}<span>${escapeHtml(host)}</span></div>
					<a class="link-url" href="${escapeHtml(node.url)}">${escapeHtml(node.url)}</a>`;
				break;
			}
			case 'group': {
				v.label.textContent = node.label ?? '';
				if (node.background) {
					const f = this.resolved(node.background);
					if (f?.uri) {
						v.el.style.setProperty('--group-bg', `url("${f.uri}")`);
						v.el.dataset.bgStyle = node.backgroundStyle ?? 'cover';
					}
				}
				break;
			}
			case 'file':
				this.renderFile(node, v);
				break;
		}
	}

	private renderFile(node: FileNode, v: NodeView): void {
		v.label.textContent = basename(node.file) + (node.subpath ?? '');
		v.label.title = node.file;
		const kind = fileKind(node.file);
		const f = this.resolved(node.file);
		if (!f) {
			v.content.innerHTML = `<div class="file-status">Loading…</div>`;
			return;
		}
		if (!f.exists) {
			v.content.innerHTML = `<div class="file-status missing">File not found<br><code>${escapeHtml(node.file)}</code></div>`;
			return;
		}
		const truncated = f.truncated ? `<div class="file-status">… file truncated</div>` : '';
		switch (kind) {
			case 'markdown':
				v.content.classList.add('markdown');
				v.content.innerHTML = renderMarkdown(sliceMarkdown(f.text ?? '', node.subpath)) + truncated;
				break;
			case 'code':
				v.content.classList.add('code');
				v.content.innerHTML = `<pre><code class="hljs">${highlight(f.text ?? '', codeLanguage(node.file))}</code></pre>${truncated}`;
				break;
			case 'image': {
				v.content.classList.add('image');
				const img = document.createElement('img');
				img.draggable = false;
				img.alt = basename(node.file);
				img.src = f.uri!;
				img.addEventListener('load', () => this.onImageLoaded(node.id, img));
				v.content.append(img);
				break;
			}
			case 'pdf':
				v.content.classList.add('pdf');
				v.pdf = new PdfView(f.uri!);
				v.content.append(v.pdf.el);
				break;
			default:
				v.content.innerHTML = `<div class="file-status">${icons.file}<br>${escapeHtml(basename(node.file))}<br><small>Double-click to open</small></div>`;
		}
	}

	private onImageLoaded(id: string, img: HTMLImageElement): void {
		if (!this.fitImage.delete(id) || !img.naturalWidth) {
			return;
		}
		const node = findNode(this.canvas, id);
		if (node) {
			this.commit(updateNode(this.canvas, id, { height: Math.round((node.width * img.naturalHeight) / img.naturalWidth) }));
		}
	}

	private renderEdges(): void {
		const byId = new Map(this.canvas.nodes.map((n) => [n.id, n]));
		const bounds = boundingBox(this.canvas.nodes) ?? { x: 0, y: 0, width: 0, height: 0 };
		const pad = 2000;
		const bx = bounds.x - pad;
		const by = bounds.y - pad;
		const bw = bounds.width + pad * 2;
		const bh = bounds.height + pad * 2;
		Object.assign(this.edgeSvg.style, { left: `${bx}px`, top: `${by}px`, width: `${bw}px`, height: `${bh}px` });
		this.edgeSvg.setAttribute('viewBox', `${bx} ${by} ${bw} ${bh}`);

		// Elements are kept per edge id (not rebuilt) so hover state and double-clicks survive re-renders.
		const seen = new Set<string>();
		let prevEdge: SVGElement | undefined;
		for (const e of this.canvas.edges) {
			const from = byId.get(e.fromNode);
			const to = byId.get(e.toNode);
			if (!from || !to) {
				continue;
			}
			seen.add(e.id);
			const g = edgeGeometry(from, to, e.fromSide, e.toSide);
			const color = resolveColor(e.color);
			const toArrow = (e.toEnd ?? 'arrow') === 'arrow';
			const fromArrow = (e.fromEnd ?? 'none') === 'arrow';
			// Stop the line at the arrow's base so it doesn't poke through the tip.
			const inset = (p: Point, side: Side): Point => {
				const n = sideNormal(side);
				return { x: p.x + n.x * ARROW * 0.8, y: p.y + n.y * ARROW * 0.8 };
			};
			const line = { ...g, start: fromArrow ? inset(g.start, g.fromSide) : g.start, end: toArrow ? inset(g.end, g.toSide) : g.end };
			const d = bezierPath(line);
			const selected = this.selEdges.has(e.id);

			let ev = this.edgeViews.get(e.id);
			if (!ev) {
				const group = svgEl('g', { class: 'edge', 'data-id': e.id });
				const hit = svgEl('path', { class: 'edge-hit' });
				const path = svgEl('path', { class: 'edge-path' });
				const head = svgEl('polygon', { class: 'edge-arrow' });
				const tail = svgEl('polygon', { class: 'edge-arrow' });
				const label = document.createElement('div');
				label.className = 'edge-label';
				label.dataset.edge = e.id;
				group.append(hit, path, head, tail);
				ev = { group, hit, path, head, tail, label };
				this.edgeViews.set(e.id, ev);
			}
			// Keep DOM order == edges array order, moving elements only when actually out of place.
			const expected: Node | null = prevEdge ? prevEdge.nextSibling : this.edgeSvg.firstChild;
			if (expected !== ev.group) {
				this.edgeSvg.insertBefore(ev.group, expected);
			}
			prevEdge = ev.group;
			ev.group.classList.toggle('selected', selected);
			if (color) {
				ev.group.style.setProperty('--edge-color', color);
				ev.label.style.setProperty('--edge-color', color);
			} else {
				ev.group.style.removeProperty('--edge-color');
				ev.label.style.removeProperty('--edge-color');
			}
			ev.hit.setAttribute('d', d);
			ev.path.setAttribute('d', d);
			ev.head.setAttribute('points', toArrow ? arrowHead(g.end, g.toSide, ARROW) : '');
			ev.tail.setAttribute('points', fromArrow ? arrowHead(g.start, g.fromSide, ARROW) : '');

			if (e.label) {
				const mid = bezierPoint(g, 0.5);
				ev.label.textContent = e.label;
				ev.label.classList.toggle('selected', selected);
				ev.label.style.left = `${mid.x}px`;
				ev.label.style.top = `${mid.y}px`;
				if (ev.label.parentNode !== this.labelLayer) {
					this.labelLayer.append(ev.label);
				}
			} else {
				ev.label.remove();
			}
		}
		for (const [id, ev] of this.edgeViews) {
			if (!seen.has(id)) {
				ev.group.remove();
				ev.label.remove();
				this.edgeViews.delete(id);
			}
		}

		const g = this.gesture;
		let pending = '';
		if (g?.kind === 'connect') {
			const from = byId.get(g.from);
			if (from) {
				const start = sideAnchor(from, g.side);
				const target = this.connectTarget(g.cursor, g.from);
				let end = g.cursor;
				let toSide: Side | undefined;
				if (target) {
					toSide = nearestSide(target, g.cursor);
					end = sideAnchor(target, toSide);
				}
				pending = bezierPath({ start, end, ...controlPoints(start, g.side, end, toSide) });
			}
		}
		this.pendingEdge.setAttribute('d', pending);
	}

	/** Show the current vault in the toolbar; clicking it lets the user pick another one. */
	private updateVault(): void {
		const vault = this.config.vault;
		this.vaultButton.querySelector('span')!.textContent = vault?.name ?? 'No vault';
		this.vaultButton.title = vault
			? `Vault: ${vault.path}\nFile paths are relative to it and note files are created in it. Click to change.`
			: 'No vault: save the canvas or open a folder, or click to choose a vault folder.';
	}

	private updateToolbar(): void {
		const any = this.selNodes.size + this.selEdges.size > 0;
		this.colorButton.disabled = !any || this.readonly;
		this.deleteButton.disabled = !any || this.readonly;
		this.toFileButton.disabled = this.readonly || !this.canvas.nodes.some((n) => n.type === 'text' && this.selNodes.has(n.id));
		for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-action="note"],[data-action="file"],[data-action="link"],[data-action="group"]')) {
			b.disabled = this.readonly;
		}
		if (!any && this.popover.dataset.kind === 'color') {
			this.closePopover();
		}
	}

	// ======================================================================
	// Viewport
	// ======================================================================

	private screenPoint(e: { clientX: number; clientY: number }): Point {
		const r = this.viewportEl.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private worldPoint(e: { clientX: number; clientY: number }): Point {
		return screenToWorld(this.view, this.screenPoint(e));
	}

	private viewCenter(): Point {
		const r = this.viewportEl.getBoundingClientRect();
		return screenToWorld(this.view, { x: r.width / 2, y: r.height / 2 });
	}

	fit(): void {
		const r = this.viewportEl.getBoundingClientRect();
		this.view = fitViewport(boundingBox(this.canvas.nodes), r.width || 800, (r.height || 600) - 50);
		this.render();
	}

	private zoomBy(factor: number, anchor?: Point): void {
		const r = this.viewportEl.getBoundingClientRect();
		this.view = zoomAt(this.view, anchor ?? { x: r.width / 2, y: r.height / 2 }, factor);
		this.markZooming();
		this.scheduleRender();
	}

	/**
	 * Promote the world to a compositor layer only while a zoom is in progress.
	 * A permanently promoted layer is rasterized once and then bitmap-scaled,
	 * which makes notes blurry; dropping the hint once zooming settles makes
	 * the browser re-rasterize at the final scale.
	 */
	private markZooming(): void {
		this.world.classList.add('zooming');
		clearTimeout(this.zoomSettleTimer);
		this.zoomSettleTimer = setTimeout(() => this.world.classList.remove('zooming'), 150);
	}

	// ======================================================================
	// Events
	// ======================================================================

	private bindEvents(): void {
		const vp = this.viewportEl;
		vp.addEventListener('pointerdown', (e) => this.onPointerDown(e));
		vp.addEventListener('pointermove', (e) => this.onPointerMove(e));
		vp.addEventListener('pointerup', (e) => this.onPointerUp(e));
		vp.addEventListener('pointercancel', () => this.cancelGesture());
		vp.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
		vp.addEventListener('dblclick', (e) => this.onDoubleClick(e));
		vp.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'copy';
			}
		});
		vp.addEventListener('drop', (e) => this.onDrop(e));
		window.addEventListener('keydown', (e) => this.onKeyDown(e));
		window.addEventListener('keyup', (e) => {
			if (e.code === 'Space') {
				this.spaceDown = false;
				this.root.classList.remove('space-pan');
			}
		});
		window.addEventListener('blur', () => {
			this.spaceDown = false;
			this.root.classList.remove('space-pan');
		});
		window.addEventListener('resize', () => this.scheduleRender());
		document.addEventListener('copy', (e) => this.onCopy(e));
		document.addEventListener('cut', (e) => {
			if (this.onCopy(e)) {
				this.deleteSelection();
			}
		});
		document.addEventListener('paste', (e) => this.onPaste(e));

		this.root.querySelector('.toolbar')!.addEventListener('click', (e) => {
			const b = (e.target as Element).closest<HTMLButtonElement>('button[data-action]');
			if (b && !b.disabled) {
				this.onToolbar(b.dataset.action!, b);
			}
		});
		// Clicking anywhere outside an open popover closes it.
		document.addEventListener('pointerdown', (e) => {
			const t = e.target as Element;
			if (!this.popover.hidden && !this.popover.contains(t) && !t.closest('.toolbar')) {
				this.closePopover();
			}
		});
	}

	private onPointerDown(e: PointerEvent): void {
		const t = e.target as Element;
		if (this.gesture || t.closest('textarea, input, button, a, .pdf-nav')) {
			return;
		}
		this.viewportEl.focus({ preventScroll: true });
		const screen = this.screenPoint(e);
		const world = screenToWorld(this.view, screen);
		const additive = e.shiftKey || e.metaKey || e.ctrlKey;

		if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
			this.startGesture(e, { kind: 'pan', start: screen, view: { ...this.view }, moved: false, clearOnClick: false });
			return;
		}
		if (e.button !== 0) {
			return;
		}
		if (this.readonly) {
			this.startGesture(e, { kind: 'pan', start: screen, view: { ...this.view }, moved: false, clearOnClick: false });
			return;
		}

		const nodeEl = t.closest<HTMLElement>('.node');
		const nodeId = nodeEl?.dataset.id;
		const handle = t.closest<HTMLElement>('.handle');
		if (nodeId && handle) {
			this.startGesture(e, { kind: 'connect', from: nodeId, side: handle.dataset.side as Side, cursor: world });
			this.root.classList.add('connecting');
			return;
		}
		if (nodeId && t.closest('.resize')) {
			const n = findNode(this.canvas, nodeId)!;
			this.startGesture(e, { kind: 'resize', start: world, base: this.canvas, id: nodeId, width: n.width, height: n.height });
			return;
		}
		if (nodeId) {
			if (this.editing === nodeId) {
				return;
			}
			const wasSelected = this.selNodes.has(nodeId);
			if (!wasSelected) {
				if (!additive) {
					this.clearSelection();
				}
				this.selNodes.add(nodeId);
				this.render();
			}
			this.startGesture(e, { kind: 'move', start: world, base: this.canvas, ids: new Set(), moved: false, nodeId, additive, wasSelected });
			return;
		}
		const edgeId = t.closest<SVGElement>('.edge')?.dataset.id ?? t.closest<HTMLElement>('.edge-label')?.dataset.edge;
		if (edgeId) {
			if (!additive) {
				this.clearSelection();
			}
			if (additive && this.selEdges.has(edgeId)) {
				this.selEdges.delete(edgeId);
			} else {
				this.selEdges.add(edgeId);
			}
			this.render();
			return;
		}
		if (e.shiftKey) {
			this.startGesture(e, { kind: 'box', start: screen, current: screen, base: new Set(this.selNodes) });
			return;
		}
		this.startGesture(e, { kind: 'pan', start: screen, view: { ...this.view }, moved: false, clearOnClick: true });
	}

	private startGesture(e: PointerEvent, g: Gesture): void {
		this.gesture = g;
		this.viewportEl.setPointerCapture(e.pointerId);
		if (g.kind === 'pan') {
			this.root.classList.add('panning');
		}
	}

	private onPointerMove(e: PointerEvent): void {
		const g = this.gesture;
		if (!g) {
			return;
		}
		const screen = this.screenPoint(e);
		const world = screenToWorld(this.view, screen);
		switch (g.kind) {
			case 'pan': {
				const dx = screen.x - g.start.x;
				const dy = screen.y - g.start.y;
				if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
					return;
				}
				g.moved = true;
				this.view = { ...g.view, x: g.view.x + dx, y: g.view.y + dy };
				break;
			}
			case 'move': {
				const dx = world.x - g.start.x;
				const dy = world.y - g.start.y;
				if (!g.moved && Math.hypot(dx, dy) * this.view.zoom < DRAG_THRESHOLD) {
					return;
				}
				if (!g.moved) {
					g.moved = true;
					g.ids = withGroupChildren(g.base, this.selNodes);
					this.root.classList.add('dragging');
				}
				this.canvas = moveNodes(g.base, g.ids, dx, dy);
				break;
			}
			case 'resize': {
				const n = findNode(g.base, g.id)!;
				const w = g.width + (world.x - g.start.x);
				const h = g.height + (world.y - g.start.y);
				this.canvas = resizeNode(g.base, n.id, w, h);
				break;
			}
			case 'connect': {
				g.cursor = world;
				const target = this.connectTarget(world, g.from);
				for (const v of this.views.values()) {
					v.el.classList.toggle('connect-target', v.el.dataset.id === target?.id);
				}
				break;
			}
			case 'box': {
				g.current = screen;
				const r = rectFromPoints(g.start, g.current);
				Object.assign(this.boxEl.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
				this.boxEl.hidden = false;
				const wr = rectFromPoints(screenToWorld(this.view, g.start), screenToWorld(this.view, g.current));
				this.selNodes.clear();
				for (const id of g.base) {
					this.selNodes.add(id);
				}
				for (const n of this.canvas.nodes) {
					if (intersects(wr, n)) {
						this.selNodes.add(n.id);
					}
				}
				break;
			}
		}
		this.scheduleRender();
	}

	private onPointerUp(e: PointerEvent): void {
		const g = this.gesture;
		if (!g) {
			return;
		}
		this.gesture = undefined;
		this.root.classList.remove('panning', 'dragging', 'connecting');
		if (this.viewportEl.hasPointerCapture(e.pointerId)) {
			this.viewportEl.releasePointerCapture(e.pointerId);
		}
		switch (g.kind) {
			case 'pan':
				if (!g.moved && g.clearOnClick) {
					this.clearSelection();
				}
				break;
			case 'move':
				if (g.moved) {
					this.commit(this.canvas);
				} else if (g.wasSelected) {
					// Plain click on an already selected node narrows the selection; shift-click toggles it.
					if (g.additive) {
						this.selNodes.delete(g.nodeId);
					} else {
						this.clearSelection();
						this.selNodes.add(g.nodeId);
					}
				}
				break;
			case 'resize':
				if (this.canvas !== g.base) {
					this.commit(this.canvas);
				}
				break;
			case 'connect':
				this.finishConnect(g.from, g.side, this.worldPoint(e));
				break;
			case 'box':
				this.boxEl.hidden = true;
				break;
		}
		this.render();
	}

	private cancelGesture(): void {
		const g = this.gesture;
		if (!g) {
			return;
		}
		if (g.kind === 'move' || g.kind === 'resize') {
			this.canvas = g.base;
		}
		this.gesture = undefined;
		this.boxEl.hidden = true;
		this.root.classList.remove('panning', 'dragging', 'connecting');
		this.render();
	}

	/** Node an in-progress edge would connect to: prefer content nodes over groups. */
	private connectTarget(p: Point, from: string): CanvasNode | undefined {
		const others = this.canvas.nodes.filter((n) => n.id !== from);
		return nodeAt(others, p, { skipGroups: true }) ?? nodeAt(others, p);
	}

	private finishConnect(from: string, fromSide: Side, p: Point): void {
		for (const v of this.views.values()) {
			v.el.classList.remove('connect-target');
		}
		const target = this.connectTarget(p, from);
		if (target) {
			this.commit(addEdge(this.canvas, { fromNode: from, fromSide, toNode: target.id, toSide: nearestSide(target, p) }));
			return;
		}
		const source = findNode(this.canvas, from);
		if (!source) {
			return;
		}
		const start = sideAnchor(source, fromSide);
		if (Math.hypot(p.x - start.x, p.y - start.y) < 40) {
			return; // a tiny drag off a handle is not a request for a new node
		}
		// Dropped on empty canvas: create a new note there and connect it.
		const [w, h] = SIZES.text;
		const toSide = opposite(fromSide);
		const n = sideNormal(toSide);
		const node: CanvasNode = {
			id: generateId(allIds(this.canvas)),
			type: 'text',
			text: '',
			x: Math.round(p.x - w / 2 - (n.x * w) / 2),
			y: Math.round(p.y - h / 2 - (n.y * h) / 2),
			width: w,
			height: h,
		};
		const next = addEdge(addNode(this.canvas, node), { fromNode: from, fromSide, toNode: node.id, toSide });
		this.clearSelection();
		this.selNodes.add(node.id);
		this.newNotes.add(node.id);
		this.commit(next);
		this.startEditing(node.id);
	}

	private onWheel(e: WheelEvent): void {
		const t = e.target as Element;
		const zoom = e.ctrlKey || e.metaKey;
		if (!zoom) {
			// Let selected/edited nodes scroll their own content.
			const nodeEl = t.closest<HTMLElement>('.node');
			const scroller = t.closest<HTMLElement>('.node-content, .pdf-page, textarea');
			if (nodeEl && scroller && (this.selNodes.has(nodeEl.dataset.id!) || this.editing === nodeEl.dataset.id) && canScroll(scroller, e)) {
				return;
			}
		}
		e.preventDefault();
		const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
		if (zoom) {
			const dy = Math.max(-60, Math.min(60, e.deltaY * scale));
			this.zoomBy(Math.pow(1.01, -dy), this.screenPoint(e));
		} else {
			this.view = { ...this.view, x: this.view.x - e.deltaX * scale, y: this.view.y - e.deltaY * scale };
			this.scheduleRender();
		}
	}

	private onDoubleClick(e: MouseEvent): void {
		if (this.readonly) {
			return;
		}
		// Pointer capture on the viewport (see startGesture) retargets dblclick to
		// the viewport itself, so resolve the element actually under the cursor.
		const t = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
		if (t.closest('textarea, input, button, .pdf-nav, .handle, .resize')) {
			return;
		}
		const edgeId = t.closest<SVGElement>('.edge')?.dataset.id ?? t.closest<HTMLElement>('.edge-label')?.dataset.edge;
		if (edgeId) {
			this.editEdgeLabel(edgeId);
			return;
		}
		const nodeEl = t.closest<HTMLElement>('.node');
		const node = nodeEl ? findNode(this.canvas, nodeEl.dataset.id!) : undefined;
		if (node) {
			switch (node.type) {
				case 'text':
					this.startEditing(node.id);
					return;
				case 'file':
					this.host.postMessage({ type: 'openFile', path: node.file, subpath: node.subpath });
					return;
				case 'link':
					this.host.postMessage({ type: 'openLink', url: node.url });
					return;
				case 'group':
					if (t.closest('.node-label')) {
						this.editGroupLabel(node.id);
					}
					return;
			}
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		const t = e.target as HTMLElement;
		if (t.closest('textarea, input, [contenteditable="true"]')) {
			return;
		}
		const mod = e.metaKey || e.ctrlKey;
		if (e.code === 'Space' && !e.repeat) {
			this.spaceDown = true;
			this.root.classList.add('space-pan');
			e.preventDefault();
			return;
		}
		if (this.readonly) {
			return;
		}
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			this.deleteSelection();
		} else if (mod && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			this.canvas.nodes.forEach((n) => this.selNodes.add(n.id));
			this.render();
		} else if (mod && e.key.toLowerCase() === 'd') {
			e.preventDefault();
			this.duplicateSelection();
		} else if (e.key === 'Escape') {
			this.clearSelection();
			this.closePopover();
			this.render();
		} else if (e.key === 'Enter' && this.selNodes.size === 1) {
			const n = findNode(this.canvas, [...this.selNodes][0]);
			if (n?.type === 'text') {
				e.preventDefault();
				this.startEditing(n.id);
			} else if (n?.type === 'group') {
				e.preventDefault();
				this.editGroupLabel(n.id);
			}
		} else if (e.key.startsWith('Arrow') && this.selNodes.size && !mod) {
			e.preventDefault();
			const step = e.shiftKey ? 1 : 10;
			const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
			const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
			this.commit(moveNodes(this.canvas, withGroupChildren(this.canvas, this.selNodes), dx, dy));
		} else if (!mod && (e.key === '+' || e.key === '=')) {
			this.zoomBy(1.2);
		} else if (!mod && e.key === '-') {
			this.zoomBy(1 / 1.2);
		} else if (e.shiftKey && e.code === 'Digit1') {
			this.fit();
		} else if (e.shiftKey && e.code === 'Digit0') {
			this.zoomBy(1 / this.view.zoom);
		}
	}

	private onDrop(e: DragEvent): void {
		e.preventDefault();
		if (this.readonly || !e.dataTransfer) {
			return;
		}
		const at = this.worldPoint(e);
		const list = e.dataTransfer.getData('application/vnd.code.uri-list') || e.dataTransfer.getData('text/uri-list');
		const uris = list
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s && !s.startsWith('#'));
		if (uris.length) {
			const files = uris.filter((u) => !/^https?:/i.test(u));
			const links = uris.filter((u) => /^https?:/i.test(u));
			if (files.length) {
				this.host.postMessage({ type: 'resolveDrop', uris: files, at });
			}
			links.forEach((url, i) => this.createLinkNode(url, { x: at.x + i * 30, y: at.y + i * 30 }));
			return;
		}
		const text = e.dataTransfer.getData('text/plain');
		if (text) {
			this.insertText(text, at);
		}
	}

	private onCopy(e: ClipboardEvent): boolean {
		const t = e.target as HTMLElement;
		if (t.closest?.('textarea, input') || !this.selNodes.size || window.getSelection()?.toString()) {
			return false;
		}
		const ids = withGroupChildren(this.canvas, this.selNodes);
		const nodes = this.canvas.nodes.filter((n) => ids.has(n.id));
		const edges = this.canvas.edges.filter((x) => ids.has(x.fromNode) && ids.has(x.toNode));
		e.clipboardData?.setData('text/plain', JSON.stringify({ nodes, edges }, null, '\t'));
		e.preventDefault();
		return true;
	}

	private onPaste(e: ClipboardEvent): void {
		const t = e.target as HTMLElement;
		if (this.readonly || t.closest?.('textarea, input')) {
			return;
		}
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text.trim()) {
			return;
		}
		e.preventDefault();
		this.insertText(text, this.viewCenter());
	}

	/** Insert pasted/dropped text: a canvas fragment, a URL, or a plain note. */
	private insertText(text: string, at: Point): void {
		const trimmed = text.trim();
		if (trimmed.startsWith('{')) {
			const { canvas } = parseCanvas(trimmed);
			if (canvas && canvas.nodes.length) {
				this.pasteFragment(canvas, at);
				return;
			}
		}
		if (/^https?:\/\/\S+$/i.test(trimmed)) {
			this.createLinkNode(trimmed, at);
			return;
		}
		const [w, h] = SIZES.text;
		const node: CanvasNode = { id: generateId(allIds(this.canvas)), type: 'text', text, x: at.x - w / 2, y: at.y - h / 2, width: w, height: h };
		this.selectOnly([node.id]);
		this.commit(addNode(this.canvas, node));
	}

	private pasteFragment(fragment: Canvas, at: Point): void {
		const bounds = boundingBox(fragment.nodes)!;
		const dx = Math.round(at.x - (bounds.x + bounds.width / 2));
		const dy = Math.round(at.y - (bounds.y + bounds.height / 2));
		// Merge, then duplicate the merged-in nodes with fresh ids and drop the originals.
		const merged: Canvas = { ...this.canvas, nodes: [...this.canvas.nodes], edges: [...this.canvas.edges] };
		const prefix = generateId();
		const tmp = (id: string): string => `${prefix}-${id}`;
		merged.nodes.push(...fragment.nodes.map((n) => ({ ...n, id: tmp(n.id) })));
		merged.edges.push(...fragment.edges.map((x) => ({ ...x, id: tmp(x.id), fromNode: tmp(x.fromNode), toNode: tmp(x.toNode) })));
		const tmpIds = fragment.nodes.map((n) => tmp(n.id));
		const { canvas, ids } = duplicate(merged, tmpIds, dx, dy);
		this.selectOnly(ids);
		this.commit(removeElements(canvas, tmpIds));
	}

	// ======================================================================
	// Commands
	// ======================================================================

	private onToolbar(action: string, button: HTMLElement): void {
		switch (action) {
			case 'note':
				this.createTextNode(this.viewCenter(), true);
				break;
			case 'file':
				this.host.postMessage({ type: 'pickFiles', at: this.viewCenter() });
				break;
			case 'link':
				this.openLinkPopover(button);
				break;
			case 'group':
				this.createGroup();
				break;
			case 'to-file':
				this.saveNotesAsFiles([...this.selNodes]);
				break;
			case 'vault':
				this.host.postMessage({ type: 'selectVault' });
				break;
			case 'color':
				this.openColorPopover(button);
				break;
			case 'delete':
				this.deleteSelection();
				break;
			case 'zoom-in':
				this.zoomBy(1.2);
				break;
			case 'zoom-out':
				this.zoomBy(1 / 1.2);
				break;
			case 'zoom-reset':
				this.zoomBy(1 / this.view.zoom);
				break;
			case 'fit':
				this.fit();
				break;
		}
	}

	private clearSelection(): void {
		this.selNodes.clear();
		this.selEdges.clear();
	}

	private selectOnly(ids: Iterable<string>): void {
		this.clearSelection();
		for (const id of ids) {
			this.selNodes.add(id);
		}
	}

	private deleteSelection(): void {
		if (!this.selNodes.size && !this.selEdges.size) {
			return;
		}
		const next = removeElements(this.canvas, this.selNodes, this.selEdges);
		this.clearSelection();
		this.commit(next);
	}

	private duplicateSelection(): void {
		if (!this.selNodes.size) {
			return;
		}
		const { canvas, ids } = duplicate(this.canvas, withGroupChildren(this.canvas, this.selNodes));
		this.selectOnly(ids);
		this.commit(canvas);
	}

	private createTextNode(center: Point, edit: boolean): void {
		const [w, h] = SIZES.text;
		const node: CanvasNode = {
			id: generateId(allIds(this.canvas)),
			type: 'text',
			text: '',
			x: Math.round(center.x - w / 2),
			y: Math.round(center.y - h / 2),
			width: w,
			height: h,
		};
		this.selectOnly([node.id]);
		this.commit(addNode(this.canvas, node));
		if (edit) {
			this.newNotes.add(node.id);
			this.startEditing(node.id);
		}
	}

	/** Ask the host to write these text notes to Markdown files; it answers with `noteFilesCreated`. */
	private saveNotesAsFiles(ids: Iterable<string>): void {
		const set = new Set(ids);
		const notes = this.canvas.nodes.flatMap((n) => (n.type === 'text' && set.has(n.id) ? [{ nodeId: n.id, text: n.text }] : []));
		if (notes.length && !this.readonly) {
			this.host.postMessage({ type: 'createNoteFiles', notes });
		}
	}

	private createLinkNode(url: string, center: Point): void {
		const [w, h] = SIZES.link;
		const node: CanvasNode = { id: generateId(allIds(this.canvas)), type: 'link', url, x: center.x - w / 2, y: center.y - h / 2, width: w, height: h };
		this.selectOnly([node.id]);
		this.commit(addNode(this.canvas, node));
	}

	private createGroup(): void {
		const selected = this.canvas.nodes.filter((n) => this.selNodes.has(n.id));
		const bounds = boundingBox(selected);
		const pad = 40;
		const c = this.viewCenter();
		const rect = bounds
			? { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 }
			: { x: c.x - 300, y: c.y - 200, width: 600, height: 400 };
		const node: CanvasNode = { id: generateId(allIds(this.canvas)), type: 'group', label: 'Group', ...rect };
		this.selectOnly([node.id]);
		this.commit(addNode(this.canvas, node));
		this.editGroupLabel(node.id);
	}

	private insertFiles(paths: string[], at: Point | undefined): void {
		if (this.readonly || !paths.length) {
			return;
		}
		const origin = at ?? this.viewCenter();
		let next = this.canvas;
		const ids: string[] = [];
		paths.forEach((file, i) => {
			const kind = fileKind(file);
			const [w, h] = SIZES[kind] ?? SIZES.other;
			const node: CanvasNode = {
				id: generateId(allIds(next)),
				type: 'file',
				file,
				x: Math.round(origin.x - w / 2 + i * 40),
				y: Math.round(origin.y - h / 2 + i * 40),
				width: w,
				height: h,
			};
			if (kind === 'image') {
				this.fitImage.add(node.id);
			}
			ids.push(node.id);
			next = addNode(next, node);
		});
		this.selectOnly(ids);
		this.commit(next);
	}

	private applyColor(color: CanvasColor | undefined): void {
		let next = this.canvas;
		for (const id of this.selNodes) {
			next = updateNode(next, id, { color });
		}
		for (const id of this.selEdges) {
			next = updateEdge(next, id, { color });
		}
		this.commit(next);
	}

	// ======================================================================
	// Inline editors & popovers
	// ======================================================================

	private startEditing(id: string): void {
		const node = findNode(this.canvas, id);
		const v = this.views.get(id);
		if (!node || node.type !== 'text' || !v) {
			return;
		}
		this.editing = id;
		v.el.classList.add('editing');
		const ta = document.createElement('textarea');
		ta.className = 'node-editor';
		ta.value = node.text;
		ta.spellcheck = true;
		ta.placeholder = 'Write Markdown…';
		v.content.className = 'node-content';
		v.content.replaceChildren(ta);
		let done = false;
		const finish = (): void => {
			if (done) {
				return;
			}
			done = true;
			this.editing = undefined;
			v.key = ''; // force re-render of content
			const current = findNode(this.canvas, id);
			if (current?.type === 'text' && current.text !== ta.value) {
				this.commit(updateNode(this.canvas, id, { text: ta.value }));
			} else {
				this.render();
			}
			// A freshly created note becomes a vault file once it has content; empty notes stay inline.
			if (this.newNotes.delete(id) && this.config.newNoteFormat === 'markdownFile' && ta.value.trim()) {
				this.saveNotesAsFiles([id]);
			}
		};
		ta.addEventListener('blur', finish);
		ta.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
				e.preventDefault();
				ta.blur();
			} else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
				// Keep focus in the editor: Tab indents instead of moving focus (which would blur and end editing).
				e.preventDefault();
				applyIndent(ta, e.shiftKey);
			}
		});
		ta.focus({ preventScroll: true });
		ta.setSelectionRange(ta.value.length, ta.value.length);
	}

	private inlineInput(parent: HTMLElement, className: string, value: string, placeholder: string, onDone: (value: string | undefined) => void): HTMLInputElement {
		const input = document.createElement('input');
		input.className = className;
		input.value = value;
		input.placeholder = placeholder;
		input.spellcheck = false;
		let done = false;
		const finish = (v: string | undefined): void => {
			if (done) {
				return;
			}
			done = true;
			input.remove();
			onDone(v);
		};
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter') {
				finish(input.value);
			} else if (e.key === 'Escape') {
				finish(undefined);
			}
		});
		input.addEventListener('blur', () => finish(input.value));
		input.addEventListener('pointerdown', (e) => e.stopPropagation());
		parent.append(input);
		input.focus({ preventScroll: true });
		input.select();
		return input;
	}

	private editGroupLabel(id: string): void {
		const v = this.views.get(id);
		const node = findNode(this.canvas, id);
		if (!v || node?.type !== 'group') {
			return;
		}
		v.label.textContent = '';
		this.inlineInput(v.label, 'label-editor', node.label ?? '', 'Group name', (value) => {
			v.key = '';
			if (value !== undefined && value !== (node.label ?? '')) {
				this.commit(updateNode(this.canvas, id, { label: value || undefined }));
			} else {
				this.render();
			}
		});
	}

	private editEdgeLabel(id: string): void {
		const edge = this.canvas.edges.find((e) => e.id === id);
		const from = edge && findNode(this.canvas, edge.fromNode);
		const to = edge && findNode(this.canvas, edge.toNode);
		if (!edge || !from || !to) {
			return;
		}
		const mid = bezierPoint(edgeGeometry(from, to, edge.fromSide, edge.toSide), 0.5);
		const input = this.inlineInput(this.labelLayer, 'edge-label-editor', edge.label ?? '', 'Label', (value) => {
			if (value !== undefined && value !== (edge.label ?? '')) {
				this.commit(updateEdge(this.canvas, id, { label: value || undefined }));
			} else {
				this.render();
			}
		});
		input.style.left = `${mid.x}px`;
		input.style.top = `${mid.y}px`;
	}

	private openPopover(kind: string, anchor: HTMLElement, build: (el: HTMLElement) => void): void {
		if (this.popover.dataset.kind === kind && !this.popover.hidden) {
			this.closePopover();
			return;
		}
		this.popover.replaceChildren();
		this.popover.dataset.kind = kind;
		build(this.popover);
		this.popover.hidden = false;
		const a = anchor.getBoundingClientRect();
		const r = this.root.getBoundingClientRect();
		this.popover.style.left = `${Math.max(8, a.left - r.left + a.width / 2 - this.popover.offsetWidth / 2)}px`;
		this.popover.style.bottom = `${r.bottom - a.top + 8}px`;
	}

	private closePopover(): void {
		this.popover.hidden = true;
		delete this.popover.dataset.kind;
	}

	private openLinkPopover(anchor: HTMLElement): void {
		this.openPopover('link', anchor, (el) => {
			const input = document.createElement('input');
			input.type = 'url';
			input.placeholder = 'https://…';
			input.className = 'popover-input';
			const add = document.createElement('button');
			add.className = 'primary';
			add.textContent = 'Add';
			const submit = (): void => {
				const url = input.value.trim();
				if (!url) {
					return;
				}
				this.closePopover();
				this.createLinkNode(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`, this.viewCenter());
			};
			add.addEventListener('click', submit);
			input.addEventListener('keydown', (e) => {
				e.stopPropagation();
				if (e.key === 'Enter') {
					submit();
				} else if (e.key === 'Escape') {
					this.closePopover();
				}
			});
			el.append(input, add);
			requestAnimationFrame(() => input.focus());
		});
	}

	private openColorPopover(anchor: HTMLElement): void {
		this.openPopover('color', anchor, (el) => {
			const swatch = (color: CanvasColor | undefined, title: string, css: string): HTMLButtonElement => {
				const b = document.createElement('button');
				b.className = 'swatch' + (color === undefined ? ' none' : '');
				b.title = title;
				b.style.setProperty('--swatch', css);
				b.addEventListener('click', () => this.applyColor(color));
				return b;
			};
			el.append(swatch(undefined, 'Default', 'transparent'));
			for (const [id, p] of Object.entries(PRESET_COLORS)) {
				el.append(swatch(id, `${p.name} (preset ${id})`, p.hex));
			}
			const custom = document.createElement('input');
			custom.type = 'color';
			custom.title = 'Custom color';
			custom.className = 'swatch-custom';
			custom.addEventListener('change', () => this.applyColor(custom.value.toUpperCase()));
			el.append(custom);
		});
	}
}

function opposite(side: Side): Side {
	return ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const)[side];
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k, v);
	}
	return el;
}

function canScroll(el: HTMLElement, e: WheelEvent): boolean {
	if (e.deltaY < 0 && el.scrollTop > 0) {
		return true;
	}
	if (e.deltaY > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
		return true;
	}
	if (e.deltaX < 0 && el.scrollLeft > 0) {
		return true;
	}
	return e.deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

/** Applies Tab / Shift+Tab indentation to a textarea, keeping it on the native undo stack. */
function applyIndent(ta: HTMLTextAreaElement, outdent: boolean): void {
	const edit = indentEdit(ta.value, ta.selectionStart, ta.selectionEnd, outdent);
	if (!edit) {
		return;
	}
	ta.setSelectionRange(edit.from, edit.to);
	// execCommand keeps the change undoable with Cmd/Ctrl+Z; setRangeText is the fallback.
	if (!document.execCommand('insertText', false, edit.insert)) {
		ta.setRangeText(edit.insert, edit.from, edit.to);
	}
	ta.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}
