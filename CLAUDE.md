# CLAUDE.md

## Workflow rules

- Every change must be made in its own git worktree.
Never edit files directly in the main checkout.
- Do not push anything.

## Compatibility

- The extension is under active development.
Breaking API changes are acceptable, and backwards compatibility is never required.
Do not add migration paths, compatibility shims, or deprecated aliases; change things directly.
