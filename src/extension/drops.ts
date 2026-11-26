import * as vscode from 'vscode';
import { numberedName, safeFileName } from '../shared/fileNames';
import type { DroppedFile } from '../shared/protocol';

/**
 * The files among URIs dropped from VS Code (Explorer, tabs): unparsable
 * entries, other schemes, folders and missing files are left out.
 */
export async function droppedFiles(uris: readonly string[], schemes: readonly string[]): Promise<vscode.Uri[]> {
	const out: vscode.Uri[] = [];
	for (const raw of uris) {
		try {
			const uri = vscode.Uri.parse(raw.trim(), true);
			if (schemes.includes(uri.scheme) && (await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) {
				out.push(uri);
			}
		} catch {
			// unparsable, or gone
		}
	}
	return out;
}

/**
 * Copy files dropped from outside VS Code into `dir` and return where each one
 * landed. A name that is taken gets a number (`photo 1.png`), unless the file
 * there has the same contents, in which case that file is reused instead of
 * being duplicated.
 */
export async function importFiles(dir: vscode.Uri, files: readonly DroppedFile[]): Promise<vscode.Uri[]> {
	const out: vscode.Uri[] = [];
	for (const file of files) {
		const name = safeFileName(file.name);
		for (let n = 0; ; n++) {
			const target = vscode.Uri.joinPath(dir, numberedName(name, n));
			const existing = await readIfExists(target);
			if (existing === undefined) {
				await vscode.workspace.fs.writeFile(target, file.data);
				out.push(target);
				break;
			}
			if (existing !== 'other' && sameBytes(existing, file.data)) {
				out.push(target);
				break;
			}
		}
	}
	return out;
}

/** The file's bytes, `'other'` for a directory or similar, or `undefined` when nothing is there. */
async function readIfExists(uri: vscode.Uri): Promise<Uint8Array | 'other' | undefined> {
	let stat: vscode.FileStat;
	try {
		stat = await vscode.workspace.fs.stat(uri);
	} catch {
		return undefined;
	}
	return stat.type & vscode.FileType.File ? vscode.workspace.fs.readFile(uri) : 'other';
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.byteLength !== b.byteLength) {
		return false;
	}
	for (let i = 0; i < a.byteLength; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}
