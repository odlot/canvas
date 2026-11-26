import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	workspaceFolder: './test/fixtures',
	mocha: { timeout: 20000 },
	// VS Code puts an IPC socket in its user-data dir. The default (.vscode-test/
	// in the checkout) exceeds the 103-character socket path limit on macOS when
	// run from a deep path such as a .claude/worktrees/ checkout.
	launchArgs: ['--user-data-dir', join(tmpdir(), 'canvas-vscode-test')],
});
