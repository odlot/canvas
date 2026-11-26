/** One row of the "Add File from Workspace" picker. */
export interface PickerEntry {
	/** File name, which the fuzzy filter matches first. */
	label: string;
	/** Folder the file is in, relative to the workspace ('' at the root). */
	description: string;
	/** Workspace-relative path with forward slashes. */
	path: string;
}

/**
 * Picker rows for workspace-relative file paths, sorted by path, leaving out
 * the paths in `exclude` (e.g. the canvas being edited).
 */
export function pickerEntries(paths: readonly string[], exclude: readonly string[] = []): PickerEntry[] {
	const skip = new Set(exclude.map(normalize));
	return paths
		.map(normalize)
		.filter((p) => !skip.has(p))
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
		.map((path) => {
			const slash = path.lastIndexOf('/');
			return { label: path.slice(slash + 1), description: slash < 0 ? '' : path.slice(0, slash), path };
		});
}

function normalize(path: string): string {
	return path.replace(/\\/g, '/');
}
