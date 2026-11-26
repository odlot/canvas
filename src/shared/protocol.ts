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

/** How new notes are stored: inline in the canvas, or as a Markdown file in the vault. */
export type NewNoteFormat = 'text' | 'markdownFile';

export interface CanvasConfig {
	newNoteFormat: NewNoteFormat;
	/** The folder canvas paths resolve against; absent for an unsaved canvas outside any workspace. */
	vault?: { name: string; path: string };
}

export type HostToWebview =
	| { type: 'load'; canvas: Canvas | undefined; issues: ValidationIssue[]; text: string }
	| { type: 'config'; config: CanvasConfig }
	| { type: 'file'; file: ResolvedFile }
	/** The vault changed: every resolved file is stale and must be requested again. */
	| { type: 'resetFiles' }
	| { type: 'insertFiles'; paths: string[]; at?: { x: number; y: number } }
	/** Reply to `createNoteFiles`: text node id → vault path of the Markdown file now holding its text. */
	| { type: 'noteFilesCreated'; files: { nodeId: string; path: string }[] };

export type WebviewToHost =
	| { type: 'ready' }
	| { type: 'edit'; canvas: Canvas }
	| { type: 'requestFile'; path: string }
	| { type: 'openFile'; path: string; subpath?: string }
	| { type: 'openLink'; url: string }
	| { type: 'pickFiles'; at: { x: number; y: number } }
	| { type: 'resolveDrop'; uris: string[]; at: { x: number; y: number } }
	| { type: 'openAsText' }
	/** Let the user pick a different vault folder. */
	| { type: 'selectVault' }
	/** Write each note's text to a new Markdown file in the vault. */
	| { type: 'createNoteFiles'; notes: { nodeId: string; text: string }[] };
