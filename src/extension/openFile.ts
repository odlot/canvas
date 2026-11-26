import * as vscode from 'vscode';
import { fileKind } from '../shared/fileKinds';
import { PdfEditorProvider } from './pdfEditor';

/**
 * Open a file referenced from a canvas next to it. PDFs go to the built-in PDF
 * viewer (VS Code itself can't display them); everything else opens in the
 * editor VS Code would pick.
 */
export async function openFileBeside(uri: vscode.Uri): Promise<void> {
	const options: vscode.TextDocumentShowOptions = { preview: false, viewColumn: vscode.ViewColumn.Beside };
	if (fileKind(uri.path) === 'pdf') {
		await vscode.commands.executeCommand('vscode.openWith', uri, PdfEditorProvider.viewType, options);
	} else {
		await vscode.commands.executeCommand('vscode.open', uri, options);
	}
}
