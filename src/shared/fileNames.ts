/** Helpers for naming files that are copied into the workspace (e.g. dropped from the OS). */

/** Largest file the webview will copy into the workspace on drop. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/**
 * A dropped file's name made safe to use as a single path segment: no
 * directories, no characters that are invalid on common file systems.
 */
export function safeFileName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	const cleaned = base
		.replace(/[<>:"|?*\u0000-\u001f]/g, '_')
		.replace(/^[.\s]+|[.\s]+$/g, '');
	return cleaned || 'file';
}

/**
 * The `n`th alternative for a taken file name: `photo.png` → `photo 1.png`.
 * `n = 0` returns the name unchanged.
 */
export function numberedName(name: string, n: number): string {
	if (n === 0) {
		return name;
	}
	const dot = name.lastIndexOf('.');
	return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`;
}
