import * as pdfjs from 'pdfjs-dist';

let workerReady: Promise<void> | undefined;

/**
 * Webview resources live on a different origin than the webview itself, so a
 * Worker can't be constructed from their URL directly. Fetch the worker script
 * and start it from a same-origin blob URL instead. Without a URL pdf.js falls
 * back to running on the main thread.
 */
export function ensurePdfWorker(src: string | undefined): Promise<void> {
	workerReady ??= (async () => {
		if (!src) {
			return;
		}
		const code = await (await fetch(src)).text();
		const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
		pdfjs.GlobalWorkerOptions.workerPort = new Worker(url);
	})();
	return workerReady;
}
