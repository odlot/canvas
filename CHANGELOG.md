# Change Log

## Unreleased

- Vault folder: the `canvas.vault` setting (or **Canvas: Select Vault Folder**) sets where canvas file paths are resolved and where new files are created.
- Notes as Markdown files: the toolbar's *Save as Markdown file* button turns selected notes into `.md` files in the vault (`canvas.notesFolder`), and `canvas.newNoteFormat: "markdownFile"` does it automatically for new notes.
- PDF viewer: double-clicking a PDF node opens it in a pdf.js viewer built for very large documents. It streams byte ranges and renders lazily. It has an outline, links with back/forward, find, page jump and zoom.

## 0.0.1

- Initial MVP: JSON Canvas 1.0 editor for `.canvas` files with text, file (Markdown, code, images, PDF), link and group nodes; drag, resize, pan, zoom, edge creation, colors, labels.
