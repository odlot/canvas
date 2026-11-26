import * as vscode from 'vscode';
import { pickerEntries } from '../shared/filePicker';

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

/**
 * Let the user fuzzy-find a workspace file, like Quick Open (⌘P / Ctrl+P).
 * Resolves with the chosen file, or undefined when the picker is dismissed.
 */
export function pickWorkspaceFile(exclude?: vscode.Uri): Promise<vscode.Uri | undefined> {
	type Item = vscode.QuickPickItem & { uri: vscode.Uri };
	const qp = vscode.window.createQuickPick<Item>();
	qp.title = 'Add File to Canvas';
	qp.placeholder = 'Search files by name';
	qp.matchOnDescription = true;
	qp.busy = true;
	qp.show();

	void vscode.workspace.findFiles('**/*').then((uris) => {
		const rel = (u: vscode.Uri): string => vscode.workspace.asRelativePath(u, false).replace(/\\/g, '/');
		const byPath = new Map(uris.map((u) => [rel(u), u]));
		const skip = exclude ? [rel(exclude)] : [];
		qp.items = pickerEntries([...byPath.keys()], skip).map((e) => {
			const uri = byPath.get(e.path)!;
			return { label: e.label, description: e.description, uri, resourceUri: uri, iconPath: vscode.ThemeIcon.File };
		});
		qp.busy = false;
	});

	return new Promise((resolve) => {
		qp.onDidAccept(() => {
			const item = qp.selectedItems[0] ?? qp.activeItems[0];
			if (item) {
				resolve(item.uri);
				qp.hide();
			}
		});
		qp.onDidHide(() => {
			resolve(undefined);
			qp.dispose();
		});
	});
}
