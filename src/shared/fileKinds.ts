/** How a `file` node should be rendered, decided by extension. */
export type FileKind = 'markdown' | 'image' | 'pdf' | 'code' | 'other';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif', 'ico']);
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);

/** File extension → highlight.js language id. */
const CODE_LANGS: Record<string, string> = {
	ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
	js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
	json: 'json', jsonc: 'json', canvas: 'json',
	py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
	swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
	php: 'php', scala: 'scala', lua: 'lua', r: 'r', dart: 'dart', ex: 'elixir', exs: 'elixir',
	hs: 'haskell', clj: 'clojure', ml: 'ocaml', fs: 'fsharp', pl: 'perl', zig: 'zig',
	sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell',
	sql: 'sql', graphql: 'graphql', gql: 'graphql',
	html: 'xml', htm: 'xml', xml: 'xml', vue: 'xml', svelte: 'xml',
	css: 'css', scss: 'scss', less: 'less',
	yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', env: 'bash',
	dockerfile: 'dockerfile', makefile: 'makefile', mk: 'makefile', cmake: 'cmake',
	txt: 'plaintext', log: 'plaintext', csv: 'plaintext',
};

export function fileExtension(path: string): string {
	const base = path.split(/[\\/]/).pop() ?? '';
	const dot = base.lastIndexOf('.');
	if (dot <= 0) {
		// Extension-less files like "Dockerfile" or "Makefile".
		return base.toLowerCase();
	}
	return base.slice(dot + 1).toLowerCase();
}

export function fileKind(path: string): FileKind {
	const ext = fileExtension(path);
	if (MARKDOWN_EXTS.has(ext)) {
		return 'markdown';
	}
	if (IMAGE_EXTS.has(ext)) {
		return 'image';
	}
	if (ext === 'pdf') {
		return 'pdf';
	}
	if (ext in CODE_LANGS) {
		return 'code';
	}
	return 'other';
}

export function codeLanguage(path: string): string | undefined {
	return CODE_LANGS[fileExtension(path)];
}

/** Whether the extension host should read this file as text for the webview. */
export function isTextKind(kind: FileKind): boolean {
	return kind === 'markdown' || kind === 'code';
}

export function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Extract the part of a markdown document a `subpath` points at.
 * `#Heading` → that heading's section (until the next heading of the same or higher level).
 * `#^block` → the paragraph/line ending with `^block`.
 * Returns the whole document if the target isn't found.
 */
export function sliceMarkdown(md: string, subpath: string | undefined): string {
	if (!subpath || !subpath.startsWith('#') || subpath.length < 2) {
		return md;
	}
	const target = subpath.slice(1);
	const lines = md.split(/\r?\n/);
	if (target.startsWith('^')) {
		const ref = target;
		const idx = lines.findIndex((l) => l.trimEnd().endsWith(` ${ref}`) || l.trim() === ref);
		if (idx < 0) {
			return md;
		}
		let start = idx;
		while (start > 0 && lines[start - 1].trim() !== '') {
			start--;
		}
		return lines
			.slice(start, idx + 1)
			.join('\n')
			.replace(new RegExp(`\\s*\\${ref}\\s*$`), '');
	}
	const norm = (s: string): string => s.trim().toLowerCase();
	const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
	let start = -1;
	let level = 0;
	for (let i = 0; i < lines.length; i++) {
		const m = heading.exec(lines[i]);
		if (!m) {
			continue;
		}
		if (start < 0) {
			if (norm(m[2]) === norm(target)) {
				start = i;
				level = m[1].length;
			}
		} else if (m[1].length <= level) {
			return lines.slice(start, i).join('\n');
		}
	}
	return start < 0 ? md : lines.slice(start).join('\n');
}
