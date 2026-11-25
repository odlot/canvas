import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCanvas, parseCanvas, serializeCanvas, validateCanvas } from '../../src/shared/validate';

const fixture = (name: string): string => readFileSync(join(__dirname, '../fixtures', name), 'utf8');

const node = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: 'a',
	type: 'text',
	text: 'hello',
	x: 0,
	y: 0,
	width: 100,
	height: 50,
	...extra,
});

const errors = (data: unknown): string[] =>
	validateCanvas(data)
		.filter((i) => i.severity === 'error')
		.map((i) => `${i.path}: ${i.message}`);

const warnings = (data: unknown): string[] =>
	validateCanvas(data)
		.filter((i) => i.severity === 'warning')
		.map((i) => i.path);

describe('top level', () => {
	it('accepts an empty object (both arrays are optional)', () => {
		expect(errors({})).toEqual([]);
	});

	it('accepts empty arrays', () => {
		expect(errors({ nodes: [], edges: [] })).toEqual([]);
	});

	it.each([null, [], 'x', 42])('rejects non-object root %j', (v) => {
		expect(errors(v)).toHaveLength(1);
	});

	it('rejects non-array nodes / edges', () => {
		expect(errors({ nodes: {}, edges: 'x' })).toEqual(['nodes: "nodes" must be an array', 'edges: "edges" must be an array']);
	});

	it('validates the full sample fixture without issues', () => {
		const { canvas, issues } = parseCanvas(fixture('sample.canvas'));
		expect(issues).toEqual([]);
		expect(canvas?.nodes.map((n) => n.type)).toEqual(['group', 'text', 'file', 'file', 'file', 'file', 'link']);
		expect(canvas?.edges).toHaveLength(3);
	});
});

describe('generic node attributes', () => {
	it.each(['id', 'type', 'x', 'y', 'width', 'height'])('requires %s', (key) => {
		const n = node();
		delete n[key];
		expect(errors({ nodes: [n] })).toEqual([`nodes[0].${key}: "${key}" is required`]);
	});

	it('rejects an unknown node type', () => {
		expect(errors({ nodes: [node({ type: 'video' })] })[0]).toMatch(/"type" must be one of "text", "file", "link", "group"/);
	});

	it('rejects non-numeric coordinates', () => {
		expect(errors({ nodes: [node({ x: '10' })] })).toEqual(['nodes[0].x: "x" must be a number']);
		expect(errors({ nodes: [node({ y: Number.NaN })] })).toEqual(['nodes[0].y: "y" must be a number']);
	});

	it('warns (but loads) non-integer coordinates, rounding them', () => {
		const data = { nodes: [node({ x: 10.6, width: 99.4 })] };
		expect(errors(data)).toEqual([]);
		expect(warnings(data)).toEqual(['nodes[0].x', 'nodes[0].width']);
		const c = normalizeCanvas(data);
		expect(c.nodes[0]).toMatchObject({ x: 11, width: 99 });
	});

	it('allows negative positions', () => {
		expect(validateCanvas({ nodes: [node({ x: -500, y: -20 })] })).toEqual([]);
	});

	it('warns on non-positive size', () => {
		expect(warnings({ nodes: [node({ width: 0 })] })).toEqual(['nodes[0].width']);
	});

	it('rejects duplicate node ids', () => {
		expect(errors({ nodes: [node(), node()] })).toEqual(['nodes[1].id: duplicate node id "a"']);
	});

	it('rejects empty id', () => {
		expect(errors({ nodes: [node({ id: '' })] })).toEqual(['nodes[0].id: "id" must not be empty']);
	});
});

describe('colors', () => {
	it.each(['1', '2', '3', '4', '5', '6', '#FF0000', '#ff0000', '#abc'])('accepts %s', (color) => {
		expect(validateCanvas({ nodes: [node({ color })] })).toEqual([]);
	});

	it.each(['0', '7', 'red', '#GG0000', '#ff00'])('warns on unrecognized color %s', (color) => {
		expect(warnings({ nodes: [node({ color })] })).toEqual(['nodes[0].color']);
	});

	it('rejects a non-string color', () => {
		expect(errors({ nodes: [node({ color: 1 })] })).toEqual(['nodes[0].color: "color" must be a string']);
	});
});

describe('text nodes', () => {
	it('requires text', () => {
		expect(errors({ nodes: [node({ text: undefined })] })).toEqual(['nodes[0].text: "text" is required']);
	});

	it('allows empty text', () => {
		expect(errors({ nodes: [node({ text: '' })] })).toEqual([]);
	});
});

describe('file nodes', () => {
	const file = (extra = {}) => node({ type: 'file', text: undefined, file: 'notes/a.md', ...extra });

	it('requires file', () => {
		expect(errors({ nodes: [file({ file: undefined })] })).toEqual(['nodes[0].file: "file" is required']);
	});

	it('accepts a subpath starting with #', () => {
		expect(errors({ nodes: [file({ subpath: '#Heading' })] })).toEqual([]);
	});

	it('rejects a subpath without #', () => {
		expect(errors({ nodes: [file({ subpath: 'Heading' })] })).toEqual(['nodes[0].subpath: "subpath" must start with "#"']);
	});
});

describe('link nodes', () => {
	it('requires url', () => {
		const n = node({ type: 'link', text: undefined });
		expect(errors({ nodes: [n] })).toEqual(['nodes[0].url: "url" is required']);
		expect(errors({ nodes: [{ ...n, url: 'https://jsoncanvas.org' }] })).toEqual([]);
	});
});

describe('group nodes', () => {
	const group = (extra = {}) => node({ type: 'group', text: undefined, ...extra });

	it('needs no type-specific attributes', () => {
		expect(errors({ nodes: [group()] })).toEqual([]);
	});

	it.each(['cover', 'ratio', 'repeat'])('accepts backgroundStyle %s', (backgroundStyle) => {
		expect(errors({ nodes: [group({ label: 'L', background: 'bg.png', backgroundStyle })] })).toEqual([]);
	});

	it('rejects an unknown backgroundStyle', () => {
		expect(errors({ nodes: [group({ backgroundStyle: 'stretch' })] })).toHaveLength(1);
	});

	it('rejects a non-string label', () => {
		expect(errors({ nodes: [group({ label: 5 })] })).toEqual(['nodes[0].label: "label" must be a string']);
	});
});

describe('edges', () => {
	const nodes = [node({ id: 'a' }), node({ id: 'b' })];
	const edge = (extra: Record<string, unknown> = {}) => ({ id: 'e', fromNode: 'a', toNode: 'b', ...extra });

	it('accepts a minimal edge', () => {
		expect(validateCanvas({ nodes, edges: [edge()] })).toEqual([]);
	});

	it.each(['id', 'fromNode', 'toNode'])('requires %s', (key) => {
		const e: Record<string, unknown> = edge();
		delete e[key];
		expect(errors({ nodes, edges: [e] })).toEqual([`edges[0].${key}: "${key}" is required`]);
	});

	it('rejects references to unknown nodes', () => {
		expect(errors({ nodes, edges: [edge({ toNode: 'zzz' })] })).toEqual(['edges[0].toNode: "toNode" references unknown node "zzz"']);
	});

	it('rejects references when nodes are absent', () => {
		expect(errors({ edges: [edge()] })).toHaveLength(2);
	});

	it.each(['top', 'right', 'bottom', 'left'])('accepts side %s', (side) => {
		expect(errors({ nodes, edges: [edge({ fromSide: side, toSide: side })] })).toEqual([]);
	});

	it('rejects invalid sides and ends', () => {
		expect(errors({ nodes, edges: [edge({ fromSide: 'middle', toEnd: 'circle' })] })).toEqual([
			'edges[0].fromSide: "fromSide" must be one of "top", "right", "bottom", "left"',
			'edges[0].toEnd: "toEnd" must be one of "none", "arrow"',
		]);
	});

	it('accepts all end shapes, color and label', () => {
		expect(validateCanvas({ nodes, edges: [edge({ fromEnd: 'arrow', toEnd: 'none', color: '3', label: 'leads to' })] })).toEqual([]);
	});

	it('rejects duplicate edge ids', () => {
		expect(errors({ nodes, edges: [edge(), edge()] })).toEqual(['edges[1].id: duplicate edge id "e"']);
	});
});

describe('parseCanvas', () => {
	it('treats an empty file as an empty canvas', () => {
		expect(parseCanvas('')).toEqual({ canvas: { nodes: [], edges: [] }, issues: [] });
		expect(parseCanvas('  \n')).toEqual({ canvas: { nodes: [], edges: [] }, issues: [] });
	});

	it('reports invalid JSON', () => {
		const r = parseCanvas('{ "nodes": [');
		expect(r.canvas).toBeUndefined();
		expect(r.issues[0].message).toMatch(/^invalid JSON/);
	});

	it('returns no canvas when there are errors', () => {
		expect(parseCanvas(fixture('invalid.canvas')).canvas).toBeUndefined();
	});

	it('fills in missing arrays', () => {
		expect(parseCanvas('{}').canvas).toEqual({ nodes: [], edges: [] });
	});

	it('preserves node order (z-index ascending)', () => {
		const c = parseCanvas(JSON.stringify({ nodes: [node({ id: 'z' }), node({ id: 'a' }), node({ id: 'm' })] })).canvas!;
		expect(c.nodes.map((n) => n.id)).toEqual(['z', 'a', 'm']);
	});

	it('preserves unknown properties for interop', () => {
		const text = JSON.stringify({
			metadata: { app: 'x' },
			nodes: [node({ styleAttributes: { shape: 'pill' } })],
			edges: [],
		});
		const c = parseCanvas(text).canvas!;
		expect(c.metadata).toEqual({ app: 'x' });
		expect(c.nodes[0].styleAttributes).toEqual({ shape: 'pill' });
	});
});

describe('serializeCanvas', () => {
	it('round-trips the sample fixture', () => {
		const original = JSON.parse(fixture('sample.canvas'));
		const c = parseCanvas(fixture('sample.canvas')).canvas!;
		expect(JSON.parse(serializeCanvas(c))).toEqual(original);
	});

	it('uses tab indentation', () => {
		expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes": [],\n\t"edges": []\n}\n');
	});
});
