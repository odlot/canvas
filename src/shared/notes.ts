/** Helpers for turning text notes into Markdown files in the vault. */

/** Characters that are invalid in file names on common platforms, or that break wiki-links/subpaths. */
const UNSAFE = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;
const MAX_NAME_LENGTH = 80;

/**
 * File name (without extension) for a note, taken from its first non-empty
 * line with Markdown markers stripped, e.g. `# My *idea*` → `My idea`.
 */
export function noteTitle(text: string): string {
	const line =
		text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.find((l) => l !== '' && !/^(-{3,}|\*{3,}|_{3,}|```.*)$/.test(l)) ?? '';
	const title = line
		.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
		.replace(/[*_~`]/g, '')
		.replace(UNSAFE, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|\.+$/g, '')
		.trim();
	if (!title) {
		return 'Untitled';
	}
	return title.length > MAX_NAME_LENGTH ? title.slice(0, MAX_NAME_LENGTH).trimEnd() : title;
}

/** `Title.md`, or `Title 1.md`, `Title 2.md`, … — the first candidate for which `taken` is false. */
export async function uniqueNoteName(title: string, taken: (name: string) => Promise<boolean> | boolean): Promise<string> {
	for (let i = 0; ; i++) {
		const name = i === 0 ? `${title}.md` : `${title} ${i}.md`;
		if (!(await taken(name))) {
			return name;
		}
	}
}

/** Normalize a vault-relative folder setting: forward slashes, no leading/trailing slashes, no `.`/`..` segments. */
export function normalizeFolder(folder: string): string {
	return folder
		.split(/[\\/]+/)
		.filter((s) => s !== '' && s !== '.' && s !== '..')
		.join('/');
}
