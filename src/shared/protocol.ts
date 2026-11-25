/** Messages exchanged between the extension host and the canvas webview. */
import type { Canvas } from './types';
import type { ValidationIssue } from './validate';

export interface ResolvedFile {
	/** The `file` value as written in the canvas. */
	path: string;
	exists: boolean;
	/** Webview-loadable URI (images, PDFs). */
	uri?: string;
	/** Text contents for markdown/code files. */
	text?: string;
	/** Set when the file is too large to inline. */
	truncated?: boolean;
}

export type HostToWebview =
	| { type: 'load'; canvas: Canvas | undefined; issues: ValidationIssue[]; text: string }
	| { type: 'file'; file: ResolvedFile }
	| { type: 'insertFiles'; paths: string[]; at?: { x: number; y: number } };

export type WebviewToHost =
	| { type: 'ready' }
	| { type: 'edit'; canvas: Canvas }
	| { type: 'requestFile'; path: string }
	| { type: 'openFile'; path: string; subpath?: string }
	| { type: 'openLink'; url: string }
	| { type: 'pickFiles'; at: { x: number; y: number } }
	| { type: 'resolveDrop'; uris: string[]; at: { x: number; y: number } }
	| { type: 'openAsText' };
