import * as vscode from 'vscode';

/** The URIs that point at files: folders and anything that no longer exists are left out. */
export async function onlyFiles(uris: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
	const out: vscode.Uri[] = [];
	for (const uri of uris) {
		try {
			if ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.File) {
				out.push(uri);
			}
		} catch {
			// gone
		}
	}
	return out;
}
