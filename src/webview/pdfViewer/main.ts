import { pdfjs } from './pdfjsGlobal';
import type { PdfHostToWebview } from '../../shared/pdfProtocol';
import { PdfViewerApp, type ViewerConfig, type ViewerHost } from './viewer';

declare global {
	interface Window {
		PDF_VIEWER_CONFIG?: ViewerConfig;
	}
}
declare function acquireVsCodeApi(): ViewerHost;

const app = new PdfViewerApp(pdfjs, document.getElementById('app')!, acquireVsCodeApi(), window.PDF_VIEWER_CONFIG ?? {});
window.addEventListener('message', (e: MessageEvent<PdfHostToWebview>) => app.handleMessage(e.data));
