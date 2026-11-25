import type { HostToWebview } from '../shared/protocol';
import { CanvasApp, type HostApi } from './app';

declare function acquireVsCodeApi(): HostApi;

const app = new CanvasApp(document.getElementById('app')!, acquireVsCodeApi());
window.addEventListener('message', (e: MessageEvent<HostToWebview>) => app.handleMessage(e.data));
