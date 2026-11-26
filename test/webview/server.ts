import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIME: Record<string, string> = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
};

export interface StaticServer {
	base: string;
	close(): Promise<void>;
}

/**
 * Serves the repository root (for dev/*.html and dist/) plus in-memory
 * `extra` files, keyed by URL path.
 */
export async function serveRepo(extra: Record<string, Buffer> = {}): Promise<StaticServer> {
	if (!existsSync(join(ROOT, 'dist/webview.js'))) {
		throw new Error('dist/ is missing: run `npm run test:webview`, which builds first');
	}
	const server: Server = createServer((req, res) => {
		const urlPath = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
		const type = MIME[extname(urlPath)] ?? 'text/plain';
		if (extra[urlPath]) {
			res.writeHead(200, { 'content-type': type }).end(extra[urlPath]);
			return;
		}
		const path = normalize(join(ROOT, urlPath));
		if (!path.startsWith(ROOT) || !existsSync(path) || !statSync(path).isFile()) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { 'content-type': type });
		createReadStream(path).pipe(res);
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	return {
		base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		close: () => new Promise((r) => server.close(() => r())),
	};
}
