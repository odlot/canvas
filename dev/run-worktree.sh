#!/usr/bin/env bash
# Build and launch the extension from a worktree under .claude/worktrees.
# Usage: dev/run-worktree.sh [worktree-name]
set -euo pipefail

# Resolve the main checkout, whether this script runs from it or from a worktree.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
common_dir="$(git -C "$script_dir" rev-parse --path-format=absolute --git-common-dir)"
repo_root="$(dirname "$common_dir")"
worktrees_dir="$repo_root/.claude/worktrees"

if [[ ! -d "$worktrees_dir" ]] || [[ -z "$(ls -A "$worktrees_dir")" ]]; then
	echo "No worktrees found in $worktrees_dir" >&2
	exit 1
fi

name="${1:-}"
if [[ -z "$name" ]]; then
	echo "Available worktrees:"
	for dir in "$worktrees_dir"/*/; do
		echo "  $(basename "$dir")"
	done
	read -r -p "Worktree name: " name
fi

worktree="$worktrees_dir/$name"
if [[ -z "$name" || ! -d "$worktree" ]]; then
	echo "Worktree not found: $worktree" >&2
	exit 1
fi

# Prefer the `code` CLI on PATH, fall back to the default macOS install.
if command -v code >/dev/null 2>&1; then
	code_bin="code"
else
	code_bin="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
	if [[ ! -x "$code_bin" ]]; then
		echo "VS Code CLI not found. Run 'Shell Command: Install 'code' command in PATH' in VS Code." >&2
		exit 1
	fi
fi

cd "$worktree"
if [[ ! -d node_modules ]]; then
	echo "Installing dependencies..."
	npm ci
fi
echo "Building $name..."
npm run build
echo "Launching Extension Development Host..."
"$code_bin" --extensionDevelopmentPath="$worktree" "$worktree/test/fixtures"
