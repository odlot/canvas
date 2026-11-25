import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		code({ text, lang }) {
			return `<pre><code class="hljs">${highlight(text, lang)}</code></pre>`;
		},
	},
});

export function highlight(code: string, lang: string | undefined): string {
	if (lang && hljs.getLanguage(lang)) {
		return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
	}
	if (lang === 'plaintext' || code.length > 100_000) {
		return escapeHtml(code);
	}
	return hljs.highlightAuto(code).value;
}

export function renderMarkdown(md: string): string {
	const html = marked.parse(md, { async: false }) as string;
	return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
