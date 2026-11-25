import { describe, expect, it } from 'vitest';
import {
	arrowHead,
	bezierPoint,
	boundingBox,
	containsRect,
	edgeGeometry,
	facingSide,
	fitViewport,
	intersects,
	MAX_ZOOM,
	MIN_ZOOM,
	nearestSide,
	nodeAt,
	rectFromPoints,
	screenToWorld,
	sideAnchor,
	snap,
	worldToScreen,
	zoomAt,
} from '../../src/shared/geometry';
import type { CanvasNode } from '../../src/shared/types';

const r = { x: 0, y: 0, width: 100, height: 50 };

describe('anchors and sides', () => {
	it('places anchors at side midpoints', () => {
		expect(sideAnchor(r, 'top')).toEqual({ x: 50, y: 0 });
		expect(sideAnchor(r, 'right')).toEqual({ x: 100, y: 25 });
		expect(sideAnchor(r, 'bottom')).toEqual({ x: 50, y: 50 });
		expect(sideAnchor(r, 'left')).toEqual({ x: 0, y: 25 });
	});

	it('finds the nearest side to a point', () => {
		expect(nearestSide(r, { x: 50, y: -100 })).toBe('top');
		expect(nearestSide(r, { x: 300, y: 30 })).toBe('right');
		expect(nearestSide(r, { x: 40, y: 60 })).toBe('bottom');
		expect(nearestSide(r, { x: -10, y: 25 })).toBe('left');
	});

	it('picks facing sides by dominant axis', () => {
		const right = { ...r, x: 500 };
		const below = { ...r, y: 500 };
		expect(facingSide(r, right)).toBe('right');
		expect(facingSide(right, r)).toBe('left');
		expect(facingSide(r, below)).toBe('bottom');
		expect(facingSide(below, r)).toBe('top');
	});
});

describe('edgeGeometry', () => {
	const a = { x: 0, y: 0, width: 100, height: 100 };
	const b = { x: 400, y: 0, width: 100, height: 100 };

	it('uses explicit sides when given', () => {
		const g = edgeGeometry(a, b, 'bottom', 'top');
		expect(g.start).toEqual({ x: 50, y: 100 });
		expect(g.end).toEqual({ x: 450, y: 0 });
		// Control points leave perpendicular to the sides.
		expect(g.c1.x).toBe(50);
		expect(g.c1.y).toBeGreaterThan(100);
		expect(g.c2.x).toBe(450);
		expect(g.c2.y).toBeLessThan(0);
	});

	it('chooses facing sides when omitted (spec leaves this to the app)', () => {
		const g = edgeGeometry(a, b);
		expect(g.fromSide).toBe('right');
		expect(g.toSide).toBe('left');
		expect(g.start).toEqual({ x: 100, y: 50 });
		expect(g.end).toEqual({ x: 400, y: 50 });
	});

	it('bezier starts and ends at the anchors', () => {
		const g = edgeGeometry(a, b);
		expect(bezierPoint(g, 0)).toEqual(g.start);
		expect(bezierPoint(g, 1)).toEqual(g.end);
		expect(bezierPoint(g, 0.5).y).toBeCloseTo(50);
	});

	it('arrowhead tip sits on the anchor and points into the node', () => {
		const pts = arrowHead({ x: 400, y: 50 }, 'left', 10)
			.split(' ')
			.map((p) => p.split(',').map(Number));
		expect(pts[0]).toEqual([400, 50]);
		expect(pts[1][0]).toBe(390);
		expect(pts[2][0]).toBe(390);
	});
});

describe('rect helpers', () => {
	it('containsRect', () => {
		expect(containsRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
		expect(containsRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
	});

	it('intersects', () => {
		expect(intersects(r, { x: 99, y: 49, width: 10, height: 10 })).toBe(true);
		expect(intersects(r, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
	});

	it('rectFromPoints normalizes corners', () => {
		expect(rectFromPoints({ x: 10, y: 50 }, { x: 0, y: 20 })).toEqual({ x: 0, y: 20, width: 10, height: 30 });
	});

	it('boundingBox', () => {
		expect(boundingBox([])).toBeUndefined();
		expect(boundingBox([r, { x: -50, y: 100, width: 10, height: 10 }])).toEqual({ x: -50, y: 0, width: 150, height: 110 });
	});

	it('snap', () => {
		expect(snap(23, 20)).toBe(20);
		expect(snap(31, 20)).toBe(40);
		expect(snap(2.6, 0)).toBe(3);
	});
});

describe('viewport', () => {
	const v = { x: 100, y: 50, zoom: 2 };

	it('screen/world transforms are inverse', () => {
		const p = { x: 37, y: -12 };
		expect(screenToWorld(v, worldToScreen(v, p))).toEqual(p);
		expect(worldToScreen(v, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
	});

	it('zoomAt keeps the anchor point fixed', () => {
		const anchor = { x: 300, y: 200 };
		const before = screenToWorld(v, anchor);
		const after = screenToWorld(zoomAt(v, anchor, 1.5), anchor);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('zoomAt clamps', () => {
		expect(zoomAt(v, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
		expect(zoomAt(v, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
	});

	it('fitViewport centers content and never zooms past 100%', () => {
		const fit = fitViewport({ x: 0, y: 0, width: 100, height: 100 }, 800, 600);
		expect(fit.zoom).toBe(1);
		expect(worldToScreen(fit, { x: 50, y: 50 })).toEqual({ x: 400, y: 300 });
		const big = fitViewport({ x: 0, y: 0, width: 4000, height: 1000 }, 800, 600);
		expect(big.zoom).toBeCloseTo((800 - 120) / 4000);
	});

	it('fitViewport on an empty canvas centers the origin', () => {
		expect(fitViewport(undefined, 800, 600)).toEqual({ x: 400, y: 300, zoom: 1 });
	});
});

describe('nodeAt', () => {
	const nodes = [
		{ id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500 },
		{ id: 'a', type: 'text', text: '', x: 10, y: 10, width: 100, height: 100 },
		{ id: 'b', type: 'text', text: '', x: 50, y: 50, width: 100, height: 100 },
	] as CanvasNode[];

	it('returns the topmost (last) node', () => {
		expect(nodeAt(nodes, { x: 60, y: 60 })?.id).toBe('b');
		expect(nodeAt(nodes, { x: 20, y: 20 })?.id).toBe('a');
		expect(nodeAt(nodes, { x: 400, y: 400 })?.id).toBe('g');
		expect(nodeAt(nodes, { x: 900, y: 900 })).toBeUndefined();
	});

	it('can skip groups', () => {
		expect(nodeAt(nodes, { x: 400, y: 400 }, { skipGroups: true })).toBeUndefined();
	});
});
