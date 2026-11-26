/**
 * Messages between the extension host and the PDF viewer webview.
 *
 * The host never hands the webview the whole file. It announces the file's
 * length plus a first slice, and pdf.js then asks for exactly the byte ranges
 * it needs (see `PDFDataRangeTransport`). Opening a large manual therefore only
 * reads its cross-reference table and the pages on screen.
 */

export type PdfHostToWebview =
	/**
	 * A (re)load of the document. `generation` increases on every load so
	 * replies to range requests of a previous load can be ignored.
	 */
	| { type: 'open'; generation: number; name: string; length: number; initial: Uint8Array }
	| { type: 'range'; generation: number; begin: number; data: Uint8Array }
	| { type: 'error'; message: string };

export type PdfWebviewToHost =
	| { type: 'ready' }
	| { type: 'range'; generation: number; begin: number; end: number };

/** Files up to this size are sent in one message; larger ones are streamed in ranges. */
export const WHOLE_FILE_BYTES = 2 * 1024 * 1024;

/** Size of the first slice sent with `open` for files that are streamed. */
export const INITIAL_BYTES = 64 * 1024;

/** How many bytes the host sends up front for a file of `length` bytes. */
export function initialLength(length: number): number {
	return length <= WHOLE_FILE_BYTES ? length : INITIAL_BYTES;
}
