/**
 * Pure, immutable editing operations on a canvas. Every function returns a new
 * canvas and leaves its input untouched, so the webview can keep a simple
 * "replace the model, re-render" loop and tests stay trivial.
 */
import { containsRect } from './geometry';
import type { Canvas, CanvasEdge, CanvasNode, GroupNode, Side } from './types';

export const MIN_NODE_WIDTH = 60;
export const MIN_NODE_HEIGHT = 40;

/** 16 lowercase hex chars, the same shape other JSON Canvas apps use. */
export function generateId(existing?: ReadonlySet<string>): string {
	for (;;) {
		let id = '';
		const bytes = new Uint8Array(8);
		globalThis.crypto.getRandomValues(bytes);
		for (const b of bytes) {
			id += b.toString(16).padStart(2, '0');
		}
		if (!existing?.has(id)) {
			return id;
		}
	}
}

export function allIds(canvas: Canvas): Set<string> {
	return new Set([...canvas.nodes.map((n) => n.id), ...canvas.edges.map((e) => e.id)]);
}

export function findNode(canvas: Canvas, id: string): CanvasNode | undefined {
	return canvas.nodes.find((n) => n.id === id);
}

/** Add a node on top of the stack (groups go to the bottom so they stay behind content). */
export function addNode(canvas: Canvas, node: CanvasNode): Canvas {
	if (findNode(canvas, node.id)) {
		throw new Error(`node id "${node.id}" already exists`);
	}
	const n = roundNode(node);
	const nodes = n.type === 'group' ? [n, ...canvas.nodes] : [...canvas.nodes, n];
	return { ...canvas, nodes };
}

export function updateNode(canvas: Canvas, id: string, patch: Partial<CanvasNode>): Canvas {
	return {
		...canvas,
		nodes: canvas.nodes.map((n) => (n.id === id ? roundNode({ ...n, ...patch } as CanvasNode) : n)),
	};
}

export function updateEdge(canvas: Canvas, id: string, patch: Partial<CanvasEdge>): Canvas {
	return {
		...canvas,
		edges: canvas.edges.map((e) => (e.id === id ? dropUndefined({ ...e, ...patch }) : e)),
	};
}

/** Nodes geometrically contained in a group (the spec defines group membership spatially). */
export function nodesInGroup(canvas: Canvas, group: GroupNode): CanvasNode[] {
	return canvas.nodes.filter((n) => n.id !== group.id && containsRect(group, n));
}

/**
 * Expand a set of node ids to include every node inside any selected group
 * (recursively, since groups can nest).
 */
export function withGroupChildren(canvas: Canvas, ids: Iterable<string>): Set<string> {
	const out = new Set(ids);
	const queue = [...out];
	while (queue.length) {
		const n = findNode(canvas, queue.pop()!);
		if (n?.type === 'group') {
			for (const child of nodesInGroup(canvas, n)) {
				if (!out.has(child.id)) {
					out.add(child.id);
					queue.push(child.id);
				}
			}
		}
	}
	return out;
}

export function moveNodes(canvas: Canvas, ids: Iterable<string>, dx: number, dy: number): Canvas {
	const set = new Set(ids);
	return {
		...canvas,
		nodes: canvas.nodes.map((n) => (set.has(n.id) ? roundNode({ ...n, x: n.x + dx, y: n.y + dy }) : n)),
	};
}

export function resizeNode(canvas: Canvas, id: string, width: number, height: number): Canvas {
	return updateNode(canvas, id, {
		width: Math.max(MIN_NODE_WIDTH, width),
		height: Math.max(MIN_NODE_HEIGHT, height),
	});
}

/** Remove nodes and edges; edges attached to removed nodes are removed too. */
export function removeElements(canvas: Canvas, nodeIds: Iterable<string>, edgeIds: Iterable<string> = []): Canvas {
	const nodes = new Set(nodeIds);
	const edges = new Set(edgeIds);
	return {
		...canvas,
		nodes: canvas.nodes.filter((n) => !nodes.has(n.id)),
		edges: canvas.edges.filter((e) => !edges.has(e.id) && !nodes.has(e.fromNode) && !nodes.has(e.toNode)),
	};
}

export interface NewEdge {
	fromNode: string;
	toNode: string;
	fromSide?: Side;
	toSide?: Side;
	id?: string;
}

/** Connect two existing nodes. Defaults follow the spec: no tail, arrow at the head. */
export function addEdge(canvas: Canvas, e: NewEdge): Canvas {
	if (!findNode(canvas, e.fromNode)) {
		throw new Error(`unknown node "${e.fromNode}"`);
	}
	if (!findNode(canvas, e.toNode)) {
		throw new Error(`unknown node "${e.toNode}"`);
	}
	const id = e.id ?? generateId(allIds(canvas));
	if (canvas.edges.some((x) => x.id === id)) {
		throw new Error(`edge id "${id}" already exists`);
	}
	const edge: CanvasEdge = dropUndefined({
		id,
		fromNode: e.fromNode,
		fromSide: e.fromSide,
		toNode: e.toNode,
		toSide: e.toSide,
	});
	return { ...canvas, edges: [...canvas.edges, edge] };
}

/** Move nodes to the top of the z-order, preserving their relative order. Groups are left in place. */
export function bringToFront(canvas: Canvas, ids: Iterable<string>): Canvas {
	const set = new Set(ids);
	const moving = canvas.nodes.filter((n) => set.has(n.id) && n.type !== 'group');
	if (moving.length === 0) {
		return canvas;
	}
	const rest = canvas.nodes.filter((n) => !moving.includes(n));
	return { ...canvas, nodes: [...rest, ...moving] };
}

/** Duplicate nodes (and the edges between them) offset by (dx, dy). Returns the new canvas and new ids. */
export function duplicate(canvas: Canvas, ids: Iterable<string>, dx = 30, dy = 30): { canvas: Canvas; ids: string[] } {
	const set = new Set(ids);
	const taken = allIds(canvas);
	const map = new Map<string, string>();
	const fresh = (): string => {
		const id = generateId(taken);
		taken.add(id);
		return id;
	};
	const newNodes: CanvasNode[] = [];
	for (const n of canvas.nodes) {
		if (set.has(n.id)) {
			const id = fresh();
			map.set(n.id, id);
			newNodes.push({ ...n, id, x: n.x + dx, y: n.y + dy });
		}
	}
	const newEdges: CanvasEdge[] = canvas.edges
		.filter((e) => map.has(e.fromNode) && map.has(e.toNode))
		.map((e) => ({ ...e, id: fresh(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }));
	const groups = newNodes.filter((n) => n.type === 'group');
	const others = newNodes.filter((n) => n.type !== 'group');
	return {
		canvas: { ...canvas, nodes: [...groups, ...canvas.nodes, ...others], edges: [...canvas.edges, ...newEdges] },
		ids: newNodes.map((n) => n.id),
	};
}

function roundNode<T extends CanvasNode>(n: T): T {
	return dropUndefined({
		...n,
		x: Math.round(n.x),
		y: Math.round(n.y),
		width: Math.round(n.width),
		height: Math.round(n.height),
	});
}

/** Optional properties set to `undefined` are removed so they don't linger as `null`/absent noise. */
function dropUndefined<T extends object>(o: T): T {
	const out = { ...o };
	for (const k of Object.keys(out) as (keyof T)[]) {
		if (out[k] === undefined) {
			delete out[k];
		}
	}
	return out;
}
