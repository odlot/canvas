// pdf.js's viewer component reads the core library from `globalThis.pdfjsLib`
// while its module is evaluated, so this must be imported before it.
import * as pdfjs from 'pdfjs-dist';

(globalThis as unknown as { pdfjsLib: typeof pdfjs }).pdfjsLib = pdfjs;

export { pdfjs };
