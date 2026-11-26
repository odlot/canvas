/**
 * Builds a PDF in memory for tests: many text pages (like a big reference
 * manual), a nested outline, an internal link on page 1 and a unique word that
 * only appears on one page.
 */
export interface PdfSpec {
	pages: number;
	/** Top-level outline entries; each may have children. Pages are 1-based. */
	outline?: { title: string; page: number; children?: { title: string; page: number }[] }[];
	/** An internal link drawn at the top of page 1, pointing at this page. */
	linkToPage?: number;
	/** A word that appears on exactly one page. */
	marker?: { page: number; word: string };
	/** Lines of filler text per page; makes the file large like a real manual. */
	linesPerPage?: number;
}

export function makePdf(spec: PdfSpec): Buffer {
	const objects: string[] = [];
	const add = (body: string): number => objects.push(body);
	const ref = (n: number): string => `${n} 0 R`;

	const catalog = add('');
	const pagesRoot = add('');
	const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	const pageObjs: number[] = [];
	const lines = spec.linesPerPage ?? 20;

	for (let p = 1; p <= spec.pages; p++) {
		const text: string[] = [`Page ${p} heading`];
		for (let i = 1; i < lines; i++) {
			text.push(`Line ${i} of page ${p}: the quick brown fox jumps over the lazy dog.`);
		}
		if (spec.marker?.page === p) {
			text.push(spec.marker.word);
		}
		if (p === 1 && spec.linkToPage) {
			text[0] = `Go to page ${spec.linkToPage}`;
		}
		const stream = ['BT', '/F1 12 Tf', '14 TL', '50 760 Td', ...text.map((t) => `(${t}) Tj T*`), 'ET'].join('\n');
		const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
		const page = add('');
		pageObjs.push(page);
		objects[page - 1] = `<< /Type /Page /Parent ${ref(pagesRoot)} /MediaBox [0 0 612 792] /Contents ${ref(content)} /Resources << /Font << /F1 ${ref(font)} >> >> ANNOTS >>`;
	}
	const pageRef = (p: number): string => ref(pageObjs[p - 1]);

	// Page 1's link annotation, filled in now that all page objects exist.
	for (let p = 1; p <= spec.pages; p++) {
		const i = pageObjs[p - 1] - 1;
		let annots = '';
		if (p === 1 && spec.linkToPage) {
			const link = add(`<< /Type /Annot /Subtype /Link /Rect [45 750 250 775] /Border [0 0 0] /Dest [${pageRef(spec.linkToPage)} /XYZ null null null] >>`);
			annots = `/Annots [${ref(link)}]`;
		}
		objects[i] = objects[i].replace('ANNOTS', annots);
	}

	// A balanced page tree like real manuals have (a flat 3000-entry /Kids
	// array forces readers to visit every page to find the last one).
	const FANOUT = 10;
	const parentOf = new Map<number, number>();
	const build = (nodes: { obj: number; count: number }[], into?: number): number => {
		if (nodes.length <= FANOUT && into !== undefined) {
			objects[into - 1] = `<< /Type /Pages /Count ${nodes.reduce((n, k) => n + k.count, 0)} /Kids [${nodes.map((k) => ref(k.obj)).join(' ')}] >>`;
			nodes.forEach((k) => parentOf.set(k.obj, into));
			return into;
		}
		const level: { obj: number; count: number }[] = [];
		for (let i = 0; i < nodes.length; i += FANOUT) {
			const kids = nodes.slice(i, i + FANOUT);
			const obj = add(`<< /Type /Pages /Count ${kids.reduce((n, k) => n + k.count, 0)} /Kids [${kids.map((k) => ref(k.obj)).join(' ')}] >>`);
			kids.forEach((k) => parentOf.set(k.obj, obj));
			level.push({ obj, count: kids.reduce((n, k) => n + k.count, 0) });
		}
		return build(level, into);
	};
	build(
		pageObjs.map((obj) => ({ obj, count: 1 })),
		pagesRoot,
	);
	for (const [child, parent] of parentOf) {
		objects[child - 1] = objects[child - 1].replace(/\/Parent \d+ 0 R/, `/Parent ${ref(parent)}`);
		if (!objects[child - 1].includes('/Parent')) {
			objects[child - 1] = objects[child - 1].replace('<< /Type /Pages', `<< /Type /Pages /Parent ${ref(parent)}`);
		}
	}

	let outlineEntry = '';
	if (spec.outline?.length) {
		const root = add('');
		const items = (entries: { title: string; page: number; children?: { title: string; page: number }[] }[], parent: number): number[] => {
			const ids = entries.map(() => add(''));
			entries.forEach((e, i) => {
				const kids = e.children?.length ? items(e.children, ids[i]) : [];
				const parts = [`/Title (${e.title})`, `/Parent ${ref(parent)}`, `/Dest [${pageRef(e.page)} /XYZ null null null]`];
				if (i > 0) parts.push(`/Prev ${ref(ids[i - 1])}`);
				if (i < ids.length - 1) parts.push(`/Next ${ref(ids[i + 1])}`);
				if (kids.length) parts.push(`/First ${ref(kids[0])} /Last ${ref(kids[kids.length - 1])} /Count -${kids.length}`);
				objects[ids[i] - 1] = `<< ${parts.join(' ')} >>`;
			});
			return ids;
		};
		const top = items(spec.outline, root);
		objects[root - 1] = `<< /Type /Outlines /First ${ref(top[0])} /Last ${ref(top[top.length - 1])} /Count ${top.length} >>`;
		outlineEntry = ` /Outlines ${ref(root)} /PageMode /UseOutlines`;
	}
	objects[catalog - 1] = `<< /Type /Catalog /Pages ${ref(pagesRoot)}${outlineEntry} >>`;

	let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out, 'latin1'));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${ref(catalog)} >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, 'latin1');
}
