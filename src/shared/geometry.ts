import type { CanvasNode, Side } from './types';

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Viewport: world point `p` maps to screen point `p * zoom + (x, y)`. */
export interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

export function center(r: Rect): Point {
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Midpoint of the given side of a rectangle — where edges attach. */
export function sideAnchor(r: Rect, side: Side): Point {
	switch (side) {
		case 'top':
			return { x: r.x + r.width / 2, y: r.y };
		case 'bottom':
			return { x: r.x + r.width / 2, y: r.y + r.height };
		case 'left':
			return { x: r.x, y: r.y + r.height / 2 };
		case 'right':
			return { x: r.x + r.width, y: r.y + r.height / 2 };
	}
}

/** Unit outward normal of a side. */
export function sideNormal(side: Side): Point {
	switch (side) {
		case 'top':
			return { x: 0, y: -1 };
		case 'bottom':
			return { x: 0, y: 1 };
		case 'left':
			return { x: -1, y: 0 };
		case 'right':
			return { x: 1, y: 0 };
	}
}

/** The side of `r` whose anchor is closest to `p`. */
export function nearestSide(r: Rect, p: Point): Side {
	let best: Side = 'top';
	let bestDist = Infinity;
	for (const side of ['top', 'right', 'bottom', 'left'] as const) {
		const a = sideAnchor(r, side);
		const d = (a.x - p.x) ** 2 + (a.y - p.y) ** 2;
		if (d < bestDist) {
			bestDist = d;
			best = side;
		}
	}
	return best;
}

/**
 * The side of `from` facing `to`, used when an edge omits `fromSide`/`toSide`.
 * Picks the dominant axis between the two centers.
 */
export function facingSide(from: Rect, to: Rect): Side {
	const a = center(from);
	const b = center(to);
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (Math.abs(dx) >= Math.abs(dy)) {
		return dx >= 0 ? 'right' : 'left';
	}
	return dy >= 0 ? 'bottom' : 'top';
}

export interface EdgeGeometry {
	start: Point;
	end: Point;
	c1: Point;
	c2: Point;
	fromSide: Side;
	toSide: Side;
}

/** Cubic bezier for an edge between two rectangles. */
export function edgeGeometry(from: Rect, to: Rect, fromSide?: Side, toSide?: Side): EdgeGeometry {
	const fs = fromSide ?? facingSide(from, to);
	const ts = toSide ?? facingSide(to, from);
	const start = sideAnchor(from, fs);
	const end = sideAnchor(to, ts);
	return { start, end, fromSide: fs, toSide: ts, ...controlPoints(start, fs, end, ts) };
}

/** Bezier control points that leave/enter perpendicular to the given sides. */
export function controlPoints(start: Point, fromSide: Side, end: Point, toSide: Side | undefined): { c1: Point; c2: Point } {
	const dist = Math.hypot(end.x - start.x, end.y - start.y);
	const k = clamp(dist / 2, 40, 300);
	const n1 = sideNormal(fromSide);
	const c1 = { x: start.x + n1.x * k, y: start.y + n1.y * k };
	if (!toSide) {
		return { c1, c2: end };
	}
	const n2 = sideNormal(toSide);
	return { c1, c2: { x: end.x + n2.x * k, y: end.y + n2.y * k } };
}

export function bezierPoint(g: Pick<EdgeGeometry, 'start' | 'c1' | 'c2' | 'end'>, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * g.start.x + b * g.c1.x + c * g.c2.x + d * g.end.x,
		y: a * g.start.y + b * g.c1.y + c * g.c2.y + d * g.end.y,
	};
}

export function bezierPath(g: Pick<EdgeGeometry, 'start' | 'c1' | 'c2' | 'end'>): string {
	const f = (p: Point): string => `${round2(p.x)} ${round2(p.y)}`;
	return `M ${f(g.start)} C ${f(g.c1)}, ${f(g.c2)}, ${f(g.end)}`;
}

/**
 * Triangle (as an SVG points string) for an arrowhead whose tip is at `tip`,
 * pointing *into* the node through `side` (i.e. opposite the side normal).
 */
export function arrowHead(tip: Point, side: Side, size = 12): string {
	const n = sideNormal(side);
	// Base center sits outside the node, along the normal.
	const bx = tip.x + n.x * size;
	const by = tip.y + n.y * size;
	const px = -n.y * (size / 2);
	const py = n.x * (size / 2);
	return [
		[tip.x, tip.y],
		[bx + px, by + py],
		[bx - px, by - py],
	]
		.map(([x, y]) => `${round2(x)},${round2(y)}`)
		.join(' ');
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

export function containsPoint(r: Rect, p: Point): boolean {
	return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** True if `inner` lies entirely within `outer`. */
export function containsRect(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

export function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Normalize a rect drawn between two arbitrary corners. */
export function rectFromPoints(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(a.x - b.x),
		height: Math.abs(a.y - b.y),
	};
}

export function boundingBox(rects: readonly Rect[]): Rect | undefined {
	if (rects.length === 0) {
		return undefined;
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const r of rects) {
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function screenToWorld(v: Viewport, p: Point): Point {
	return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function worldToScreen(v: Viewport, p: Point): Point {
	return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

/** Zoom by `factor` keeping the screen point `anchor` fixed. */
export function zoomAt(v: Viewport, anchor: Point, factor: number): Viewport {
	const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
	const world = screenToWorld(v, anchor);
	return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}

/** Viewport that fits `bounds` into a `width`×`height` screen with padding. */
export function fitViewport(bounds: Rect | undefined, width: number, height: number, padding = 60): Viewport {
	if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
		return { x: width / 2, y: height / 2, zoom: 1 };
	}
	const zoom = clamp(
		Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height),
		MIN_ZOOM,
		1,
	);
	const c = center(bounds);
	return { zoom, x: width / 2 - c.x * zoom, y: height / 2 - c.y * zoom };
}

/** Topmost node under a world point. Later nodes are on top (spec: ascending z-index). */
export function nodeAt(nodes: readonly CanvasNode[], p: Point, opts: { skipGroups?: boolean } = {}): CanvasNode | undefined {
	for (let i = nodes.length - 1; i >= 0; i--) {
		const n = nodes[i];
		if (opts.skipGroups && n.type === 'group') {
			continue;
		}
		if (containsPoint(n, p)) {
			return n;
		}
	}
	return undefined;
}

export function snap(v: number, grid: number): number {
	return grid > 0 ? Math.round(v / grid) * grid : Math.round(v);
}
