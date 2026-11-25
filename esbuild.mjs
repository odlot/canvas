import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const common = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	logLevel: 'info',
};

const builds = [
	// Extension host (Node, CommonJS)
	{
		...common,
		entryPoints: ['src/extension/extension.ts'],
		outfile: 'dist/extension.js',
		platform: 'node',
		format: 'cjs',
		target: 'node20',
		external: ['vscode'],
	},
	// Webview UI (browser, ESM — pdf.js requires module semantics)
	{
		...common,
		entryPoints: { webview: 'src/webview/main.ts' },
		outdir: 'dist',
		platform: 'browser',
		format: 'esm',
		target: 'chrome120',
		loader: { '.css': 'css' },
	},
	{
		...common,
		entryPoints: { webview: 'src/webview/style.css' },
		outdir: 'dist',
	},
	// pdf.js worker, started from a blob URL inside the webview
	{
		...common,
		entryPoints: { 'pdf.worker': 'node_modules/pdfjs-dist/build/pdf.worker.mjs' },
		outdir: 'dist',
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
		sourcemap: false,
	},
];

// Dev-only helper for dev/harness.html (runs the webview in a plain browser).
if (!production) {
	builds.push({ ...common, sourcemap: false, entryPoints: { 'harness-parse': 'src/shared/validate.ts' }, outdir: 'dist', format: 'esm', platform: 'browser' });
}

if (watch) {
	const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
	await Promise.all(contexts.map((c) => c.watch()));
} else {
	await Promise.all(builds.map((b) => esbuild.build(b)));
}
