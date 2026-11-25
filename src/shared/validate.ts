import { isValidColor } from './colors';
import {
	BACKGROUND_STYLES,
	EDGE_ENDS,
	NODE_TYPES,
	SIDES,
	type Canvas,
	type CanvasEdge,
	type CanvasNode,
} from './types';

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
	severity: Severity;
	/** JSON-pointer-ish location, e.g. `nodes[2].width`. */
	path: string;
	message: string;
}

export interface ParseResult {
	/** The normalized canvas, or `undefined` if the input has errors. */
	canvas: Canvas | undefined;
	issues: ValidationIssue[];
}

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Collector {
	readonly issues: ValidationIssue[] = [];
	error(path: string, message: string): void {
		this.issues.push({ severity: 'error', path, message });
	}
	warn(path: string, message: string): void {
		this.issues.push({ severity: 'warning', path, message });
	}
}

function checkRequiredString(o: Obj, key: string, path: string, c: Collector, nonEmpty = false): void {
	const v = o[key];
	if (v === undefined) {
		c.error(`${path}.${key}`, `"${key}" is required`);
	} else if (typeof v !== 'string') {
		c.error(`${path}.${key}`, `"${key}" must be a string`);
	} else if (nonEmpty && v.length === 0) {
		c.error(`${path}.${key}`, `"${key}" must not be empty`);
	}
}

function checkOptionalString(o: Obj, key: string, path: string, c: Collector): void {
	if (o[key] !== undefined && typeof o[key] !== 'string') {
		c.error(`${path}.${key}`, `"${key}" must be a string`);
	}
}

function checkOptionalEnum(o: Obj, key: string, allowed: readonly string[], path: string, c: Collector): void {
	const v = o[key];
	if (v !== undefined && (typeof v !== 'string' || !allowed.includes(v))) {
		c.error(`${path}.${key}`, `"${key}" must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
	}
}

function checkColor(o: Obj, path: string, c: Collector): void {
	const v = o.color;
	if (v === undefined) {
		return;
	}
	if (typeof v !== 'string') {
		c.error(`${path}.color`, '"color" must be a string');
	} else if (!isValidColor(v)) {
		c.warn(`${path}.color`, `"color" should be a hex color like "#FF0000" or a preset "1"–"6"; got "${v}"`);
	}
}

function checkInteger(o: Obj, key: string, path: string, c: Collector): void {
	const v = o[key];
	if (v === undefined) {
		c.error(`${path}.${key}`, `"${key}" is required`);
	} else if (typeof v !== 'number' || !Number.isFinite(v)) {
		c.error(`${path}.${key}`, `"${key}" must be a number`);
	} else if (!Number.isInteger(v)) {
		c.warn(`${path}.${key}`, `"${key}" should be an integer; it will be rounded`);
	}
}

function validateNode(node: unknown, path: string, c: Collector): void {
	if (!isObject(node)) {
		c.error(path, 'node must be an object');
		return;
	}
	checkRequiredString(node, 'id', path, c, true);
	const type = node.type;
	if (type === undefined) {
		c.error(`${path}.type`, '"type" is required');
	} else if (typeof type !== 'string' || !(NODE_TYPES as readonly string[]).includes(type)) {
		c.error(`${path}.type`, `"type" must be one of ${NODE_TYPES.map((t) => `"${t}"`).join(', ')}`);
	}
	for (const k of ['x', 'y', 'width', 'height']) {
		checkInteger(node, k, path, c);
	}
	for (const k of ['width', 'height']) {
		const v = node[k];
		if (typeof v === 'number' && v <= 0) {
			c.warn(`${path}.${k}`, `"${k}" should be positive`);
		}
	}
	checkColor(node, path, c);

	switch (type) {
		case 'text':
			checkRequiredString(node, 'text', path, c);
			break;
		case 'file':
			checkRequiredString(node, 'file', path, c, true);
			if (node.subpath !== undefined) {
				if (typeof node.subpath !== 'string') {
					c.error(`${path}.subpath`, '"subpath" must be a string');
				} else if (!node.subpath.startsWith('#')) {
					c.error(`${path}.subpath`, '"subpath" must start with "#"');
				}
			}
			break;
		case 'link':
			checkRequiredString(node, 'url', path, c, true);
			break;
		case 'group':
			checkOptionalString(node, 'label', path, c);
			checkOptionalString(node, 'background', path, c);
			checkOptionalEnum(node, 'backgroundStyle', BACKGROUND_STYLES, path, c);
			break;
	}
}

function validateEdge(edge: unknown, path: string, nodeIds: Set<string>, c: Collector): void {
	if (!isObject(edge)) {
		c.error(path, 'edge must be an object');
		return;
	}
	checkRequiredString(edge, 'id', path, c, true);
	checkRequiredString(edge, 'fromNode', path, c, true);
	checkRequiredString(edge, 'toNode', path, c, true);
	for (const k of ['fromNode', 'toNode']) {
		const v = edge[k];
		if (typeof v === 'string' && v.length > 0 && !nodeIds.has(v)) {
			c.error(`${path}.${k}`, `"${k}" references unknown node "${v}"`);
		}
	}
	checkOptionalEnum(edge, 'fromSide', SIDES, path, c);
	checkOptionalEnum(edge, 'toSide', SIDES, path, c);
	checkOptionalEnum(edge, 'fromEnd', EDGE_ENDS, path, c);
	checkOptionalEnum(edge, 'toEnd', EDGE_ENDS, path, c);
	checkColor(edge, path, c);
	checkOptionalString(edge, 'label', path, c);
}

/** Validate an already-parsed JSON value against JSON Canvas 1.0. */
export function validateCanvas(data: unknown): ValidationIssue[] {
	const c = new Collector();
	if (!isObject(data)) {
		c.error('', 'canvas must be a JSON object');
		return c.issues;
	}

	const nodeIds = new Set<string>();
	if (data.nodes !== undefined) {
		if (!Array.isArray(data.nodes)) {
			c.error('nodes', '"nodes" must be an array');
		} else {
			data.nodes.forEach((n, i) => {
				const path = `nodes[${i}]`;
				validateNode(n, path, c);
				if (isObject(n) && typeof n.id === 'string' && n.id.length > 0) {
					if (nodeIds.has(n.id)) {
						c.error(`${path}.id`, `duplicate node id "${n.id}"`);
					}
					nodeIds.add(n.id);
				}
			});
		}
	}

	if (data.edges !== undefined) {
		if (!Array.isArray(data.edges)) {
			c.error('edges', '"edges" must be an array');
		} else {
			const edgeIds = new Set<string>();
			data.edges.forEach((e, i) => {
				const path = `edges[${i}]`;
				validateEdge(e, path, nodeIds, c);
				if (isObject(e) && typeof e.id === 'string' && e.id.length > 0) {
					if (edgeIds.has(e.id)) {
						c.error(`${path}.id`, `duplicate edge id "${e.id}"`);
					}
					edgeIds.add(e.id);
				}
			});
		}
	}
	return c.issues;
}

/**
 * Normalize a valid canvas: ensure both arrays exist and round coordinates to
 * integers. Unknown properties are kept.
 */
export function normalizeCanvas(data: Record<string, unknown>): Canvas {
	const nodes = ((data.nodes as CanvasNode[] | undefined) ?? []).map((n) => ({
		...n,
		x: Math.round(n.x),
		y: Math.round(n.y),
		width: Math.round(n.width),
		height: Math.round(n.height),
	}));
	const edges = ((data.edges as CanvasEdge[] | undefined) ?? []).map((e) => ({ ...e }));
	return { ...data, nodes, edges } as Canvas;
}

/**
 * Parse canvas file contents. Empty / whitespace-only input is treated as an
 * empty canvas (so a freshly created `.canvas` file opens cleanly).
 */
export function parseCanvas(text: string): ParseResult {
	if (text.trim() === '') {
		return { canvas: { nodes: [], edges: [] }, issues: [] };
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (err) {
		return {
			canvas: undefined,
			issues: [{ severity: 'error', path: '', message: `invalid JSON: ${(err as Error).message}` }],
		};
	}
	const issues = validateCanvas(data);
	const ok = !issues.some((i) => i.severity === 'error');
	return { canvas: ok ? normalizeCanvas(data as Record<string, unknown>) : undefined, issues };
}

/** Serialize to the conventional tab-indented form used by other JSON Canvas apps. */
export function serializeCanvas(canvas: Canvas): string {
	return JSON.stringify(canvas, null, '\t') + '\n';
}
