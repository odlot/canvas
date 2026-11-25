/**
 * Types for JSON Canvas 1.0 — https://jsoncanvas.org/spec/1.0/
 *
 * Unknown properties are preserved on read and written back unchanged, so
 * canvases produced by other tools (e.g. Obsidian) round-trip losslessly.
 */

/** A hex color (`#FF0000`) or a preset color `"1"`–`"6"`. */
export type CanvasColor = string;

export type NodeType = 'text' | 'file' | 'link' | 'group';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type EdgeEnd = 'none' | 'arrow';
export type BackgroundStyle = 'cover' | 'ratio' | 'repeat';

export const NODE_TYPES: readonly NodeType[] = ['text', 'file', 'link', 'group'];
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
export const EDGE_ENDS: readonly EdgeEnd[] = ['none', 'arrow'];
export const BACKGROUND_STYLES: readonly BackgroundStyle[] = ['cover', 'ratio', 'repeat'];

interface NodeBase {
	id: string;
	type: NodeType;
	/** Integer x position in pixels. */
	x: number;
	/** Integer y position in pixels. */
	y: number;
	/** Integer width in pixels. */
	width: number;
	/** Integer height in pixels. */
	height: number;
	color?: CanvasColor;
	[extra: string]: unknown;
}

export interface TextNode extends NodeBase {
	type: 'text';
	/** Plain text with Markdown syntax. */
	text: string;
}

export interface FileNode extends NodeBase {
	type: 'file';
	/** Path to the file within the system. */
	file: string;
	/** Optional subpath linking to a heading or block; always starts with `#`. */
	subpath?: string;
}

export interface LinkNode extends NodeBase {
	type: 'link';
	url: string;
}

export interface GroupNode extends NodeBase {
	type: 'group';
	label?: string;
	/** Path to a background image. */
	background?: string;
	backgroundStyle?: BackgroundStyle;
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide?: Side;
	/** Defaults to `none`. */
	fromEnd?: EdgeEnd;
	toNode: string;
	toSide?: Side;
	/** Defaults to `arrow`. */
	toEnd?: EdgeEnd;
	color?: CanvasColor;
	label?: string;
	[extra: string]: unknown;
}

export interface CanvasData {
	/** Ordered by z-index, ascending: the first node is rendered below the rest. */
	nodes?: CanvasNode[];
	edges?: CanvasEdge[];
	[extra: string]: unknown;
}

/** A canvas where both arrays are guaranteed present — the in-memory working form. */
export interface Canvas extends CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}
