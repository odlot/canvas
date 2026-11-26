/** Indentation unit inserted by Tab in the note editor. */
export const INDENT = '\t';

/** Columns a tab stands for; also how many leading spaces Shift+Tab removes. */
const TAB_WIDTH = 4;

export interface IndentEdit {
	/** Start of the replaced range in the original text. */
	from: number;
	/** End of the replaced range in the original text. */
	to: number;
	/** Text replacing `from..to`. */
	insert: string;
	/** Selection to restore after the edit, in the new text. */
	selectionStart: number;
	selectionEnd: number;
}

/**
 * Computes the edit for Tab (indent) or Shift+Tab (outdent) in a textarea.
 *
 * - Tab with a cursor or a selection inside a single line inserts an indent.
 * - Tab with a selection spanning lines indents every non-empty selected line.
 * - Shift+Tab removes one indent level from every line touched by the selection.
 *
 * Returns undefined when nothing changes.
 */
export function indentEdit(text: string, start: number, end: number, outdent: boolean): IndentEdit | undefined {
	const multiLine = text.slice(start, end).includes('\n');
	if (!outdent && !multiLine) {
		const caret = start + INDENT.length;
		return { from: start, to: end, insert: INDENT, selectionStart: caret, selectionEnd: caret };
	}

	const lineStart = text.lastIndexOf('\n', start - 1) + 1;
	// A selection ending right after a newline does not include the next line.
	const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
	const nl = text.indexOf('\n', last);
	const lineEnd = nl === -1 ? text.length : nl;

	const lines = text.slice(lineStart, lineEnd).split('\n');
	const deltas = lines.map((line) => (outdent ? -outdentWidth(line) : line.length ? INDENT.length : 0));
	if (deltas.every((d) => d === 0)) {
		return undefined;
	}
	const insert = lines.map((line, i) => (deltas[i] < 0 ? line.slice(-deltas[i]) : deltas[i] > 0 ? INDENT + line : line)).join('\n');
	const total = deltas.reduce((a, b) => a + b, 0);

	// A selection starting at column 0 stays there, so it keeps covering whole lines.
	const anchored = start === lineStart && start !== end;
	const selectionStart = anchored ? lineStart : Math.max(lineStart, start + deltas[0]);
	const selectionEnd = start === end ? selectionStart : Math.max(selectionStart, end + total);
	return { from: lineStart, to: lineEnd, insert, selectionStart, selectionEnd };
}

/** Number of leading characters one outdent removes from `line`. */
function outdentWidth(line: string): number {
	if (line.startsWith('\t')) {
		return 1;
	}
	let n = 0;
	while (n < TAB_WIDTH && line[n] === ' ') {
		n++;
	}
	return n;
}
