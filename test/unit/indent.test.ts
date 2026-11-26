import { describe, expect, it } from 'vitest';
import { indentEdit } from '../../src/webview/indent';

/**
 * Runs indentEdit on text where `|` marks a caret or `[`..`]` a selection,
 * and returns the result with the new selection marked the same way.
 */
function run(marked: string, outdent = false): string {
	let text: string;
	let start: number;
	let end: number;
	const caret = marked.indexOf('|');
	if (caret >= 0) {
		text = marked.replace('|', '');
		start = end = caret;
	} else {
		start = marked.indexOf('[');
		end = marked.indexOf(']') - 1;
		text = marked.replace('[', '').replace(']', '');
	}
	const edit = indentEdit(text, start, end, outdent);
	if (!edit) {
		return 'unchanged';
	}
	const out = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
	if (edit.selectionStart === edit.selectionEnd) {
		return out.slice(0, edit.selectionStart) + '|' + out.slice(edit.selectionStart);
	}
	return out.slice(0, edit.selectionStart) + '[' + out.slice(edit.selectionStart, edit.selectionEnd) + ']' + out.slice(edit.selectionEnd);
}

describe('indentEdit', () => {
	it('inserts a tab at the caret', () => {
		expect(run('- a|b')).toBe('- a\t|b');
	});

	it('replaces a single-line selection with a tab', () => {
		expect(run('a[bc]d')).toBe('a\t|d');
	});

	it('indents every non-empty line of a multi-line selection', () => {
		expect(run('- [a\n\n- b]\n- c')).toBe('\t- [a\n\n\t- b]\n- c');
	});

	it('does not indent the line after a selection ending in a newline', () => {
		expect(run('[- a\n]- b')).toBe('[\t- a\n]- b');
	});

	it('outdents the caret line by one tab', () => {
		expect(run('\t\t- a|', true)).toBe('\t- a|');
	});

	it('outdents up to four spaces', () => {
		expect(run('      - a|', true)).toBe('  - a|');
		expect(run('  - a|', true)).toBe('- a|');
	});

	it('outdents all selected lines and keeps the selection', () => {
		expect(run('\t- [a\n\t- b]', true)).toBe('- [a\n- b]');
	});

	it('clamps the caret to the line start when outdenting from inside the indent', () => {
		expect(run('\t|- a', true)).toBe('|- a');
	});

	it('returns undefined when there is nothing to outdent', () => {
		expect(run('- a|', true)).toBe('unchanged');
	});
});
