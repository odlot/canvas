import { describe, expect, it } from 'vitest';
import {
	addEdge,
	addNode,
	bringToFront,
	duplicate,
	generateId,
	MIN_NODE_HEIGHT,
	MIN_NODE_WIDTH,
	moveNodes,
	removeElements,
	resizeNode,
	updateEdge,
	updateNode,
	withGroupChildren,
} from '../../src/shared/operations';
import type { Canvas, CanvasNode } from '../../src/shared/types';
import { validateCanvas } from '../../src/shared/validate';

const text = (id: string, x = 0, y = 0): CanvasNode => ({ id, type: 'text', text: id, x, y, width: 100, height: 60 });

const base = (): Canvas => ({
	nodes: [
		{ id: 'g', type: 'group', label: 'G', x: 0, y: 0, width: 400, height: 400 },
		text('a', 10, 10),
		text('b', 200, 10),
		text('c', 1000, 1000),
	],
	edges: [
		{ id: 'ab', fromNode: 'a', toNode: 'b' },
		{ id: 'bc', fromNode: 'b', toNode: 'c' },
	],
});

describe('generateId', () => {
	it('produces 16 hex chars', () => {
		expect(generateId()).toMatch(/^[0-9a-f]{16}$/);
	});

	it('avoids existing ids', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 200; i++) {
			ids.add(generateId(ids));
		}
		expect(ids.size).toBe(200);
	});
});

describe('operations keep the canvas spec-valid and are immutable', () => {
	it('addNode appends on top; groups go to the bottom', () => {
		const c0 = base();
		const c1 = addNode(c0, text('d'));
		expect(c1.nodes.at(-1)!.id).toBe('d');
		const c2 = addNode(c1, { id: 'g2', type: 'group', x: 0, y: 0, width: 10, height: 10 });
		expect(c2.nodes[0].id).toBe('g2');
		expect(c0.nodes).toHaveLength(4);
		expect(validateCanvas(c2)).toEqual([]);
	});

	it('addNode rejects duplicate ids', () => {
		expect(() => addNode(base(), text('a'))).toThrow(/already exists/);
	});

	it('addNode rounds coordinates to integers', () => {
		const c = addNode(base(), { ...text('d'), x: 1.4, y: 2.6, width: 100.5 } as CanvasNode);
		expect(c.nodes.at(-1)).toMatchObject({ x: 1, y: 3, width: 101 });
	});

	it('moveNodes shifts only the given nodes', () => {
		const c = moveNodes(base(), ['a', 'c'], 5.4, -3);
		expect(c.nodes.find((n) => n.id === 'a')).toMatchObject({ x: 15, y: 7 });
		expect(c.nodes.find((n) => n.id === 'c')).toMatchObject({ x: 1005, y: 997 });
		expect(c.nodes.find((n) => n.id === 'b')).toMatchObject({ x: 200, y: 10 });
	});

	it('resizeNode enforces a minimum size', () => {
		const c = resizeNode(base(), 'a', 5, 5);
		expect(c.nodes.find((n) => n.id === 'a')).toMatchObject({ width: MIN_NODE_WIDTH, height: MIN_NODE_HEIGHT });
	});

	it('updateNode patches and removes keys set to undefined', () => {
		let c = updateNode(base(), 'a', { color: '1' });
		expect(c.nodes.find((n) => n.id === 'a')!.color).toBe('1');
		c = updateNode(c, 'a', { color: undefined });
		expect('color' in c.nodes.find((n) => n.id === 'a')!).toBe(false);
	});

	it('updateEdge patches edges', () => {
		const c = updateEdge(base(), 'ab', { label: 'hi', toEnd: 'none' });
		expect(c.edges[0]).toEqual({ id: 'ab', fromNode: 'a', toNode: 'b', label: 'hi', toEnd: 'none' });
	});

	it('removeElements cascades to attached edges', () => {
		const c = removeElements(base(), ['b']);
		expect(c.nodes.map((n) => n.id)).toEqual(['g', 'a', 'c']);
		expect(c.edges).toEqual([]);
		expect(validateCanvas(c)).toEqual([]);
	});

	it('removeElements can delete only edges', () => {
		const c = removeElements(base(), [], ['bc']);
		expect(c.nodes).toHaveLength(4);
		expect(c.edges.map((e) => e.id)).toEqual(['ab']);
	});
});

describe('addEdge', () => {
	it('creates an edge with spec defaults (ends omitted)', () => {
		const c = addEdge(base(), { fromNode: 'a', toNode: 'c', fromSide: 'right', toSide: 'left', id: 'ac' });
		expect(c.edges.at(-1)).toEqual({ id: 'ac', fromNode: 'a', fromSide: 'right', toNode: 'c', toSide: 'left' });
		expect(validateCanvas(c)).toEqual([]);
	});

	it('omits sides that are not given', () => {
		const c = addEdge(base(), { fromNode: 'a', toNode: 'c' });
		const e = c.edges.at(-1)!;
		expect(Object.keys(e).sort()).toEqual(['fromNode', 'id', 'toNode']);
		expect(e.id).toMatch(/^[0-9a-f]{16}$/);
	});

	it('rejects unknown nodes', () => {
		expect(() => addEdge(base(), { fromNode: 'a', toNode: 'nope' })).toThrow(/unknown node/);
	});

	it('rejects a duplicate edge id', () => {
		expect(() => addEdge(base(), { fromNode: 'a', toNode: 'c', id: 'ab' })).toThrow(/already exists/);
	});
});

describe('groups', () => {
	it('withGroupChildren includes spatially contained nodes', () => {
		expect([...withGroupChildren(base(), ['g'])].sort()).toEqual(['a', 'b', 'g']);
	});

	it('handles nested groups', () => {
		const c = addNode(base(), { id: 'outer', type: 'group', x: -100, y: -100, width: 600, height: 600 });
		expect([...withGroupChildren(c, ['outer'])].sort()).toEqual(['a', 'b', 'g', 'outer']);
	});

	it('non-group ids pass through unchanged', () => {
		expect([...withGroupChildren(base(), ['c'])]).toEqual(['c']);
	});
});

describe('z-order', () => {
	it('bringToFront moves nodes to the end preserving relative order', () => {
		const c = bringToFront(base(), ['b', 'a']);
		expect(c.nodes.map((n) => n.id)).toEqual(['g', 'c', 'a', 'b']);
	});

	it('bringToFront leaves groups behind content', () => {
		const c0 = base();
		expect(bringToFront(c0, ['g'])).toBe(c0);
	});
});

describe('duplicate', () => {
	it('copies nodes and internal edges with fresh ids', () => {
		const { canvas, ids } = duplicate(base(), ['a', 'b', 'c'], 10, 20);
		expect(ids).toHaveLength(3);
		expect(canvas.nodes).toHaveLength(7);
		expect(canvas.edges).toHaveLength(4);
		const copyA = canvas.nodes.find((n) => n.id === ids[0])!;
		expect(copyA).toMatchObject({ x: 20, y: 30, text: 'a' });
		expect(validateCanvas(canvas)).toEqual([]);
	});

	it('does not copy edges leading outside the selection', () => {
		const { canvas } = duplicate(base(), ['a']);
		expect(canvas.edges).toHaveLength(2);
	});
});
