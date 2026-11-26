# CLAUDE.md

## Workflow rules

- Every change must be made in its own git worktree.
Never edit files directly in the main checkout.
- Do not push anything.

## Testing

- Every change comes with tests: add tests for new behavior and for every bug fix (a fix needs a test that fails without it).
- Keep the suite current: when a change makes tests outdated, refactor them to match, and delete tests for behavior that no longer exists.
Never leave a test that only passes by accident or asserts removed behavior.
- Validate all work with `./validation.sh` before calling it done.
It runs exactly what CI runs (dependencies, typecheck, lint, unit, webview and VS Code integration tests), and it must pass.

## Compatibility

- The extension is under active development.
Breaking API changes are acceptable, and backwards compatibility is never required.
Do not add migration paths, compatibility shims, or deprecated aliases; change things directly.
