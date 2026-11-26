# Canvas

An infinite canvas for connecting your thoughts and ideas, inside VS Code.

Canvas is a visual editor for `.canvas` files in the open [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) format, the same format Obsidian uses. The file stays plain JSON, so save, undo/redo, git diffs and *Reopen With → Text Editor* all work.

## Features

| Node | What you see |
| --- | --- |
| **Text** | Markdown (GFM) with syntax-highlighted code blocks |
| **File: Markdown** | The rendered file, honoring `subpath` (`#Heading`, `#^block`) |
| **File: code** | Syntax-highlighted source (TS/JS, Python, Go, Rust, …) |
| **File: image** | png, jpg, gif, svg, webp, … |
| **File: PDF** | Rendered with pdf.js, with page navigation |
| **Link** | A card that opens in your browser |
| **Group** | A labeled region with an optional background image; moving it moves its contents |

Files on the canvas update live when they change on disk.

### PDF viewer

Double-clicking a PDF node opens the file beside the canvas in a built-in PDF viewer (pdf.js), made for large documents such as the Arm Architecture Reference Manual:

- **Fast on huge files.** The file is streamed to the viewer in byte ranges on demand, and only pages near the viewport are rendered. On a 60 MB, 6,666-page Arm manual, the first page appears in about half a second, and jumping anywhere takes about 0.1 s.
- **Outline** sidebar (<kbd>☰</kbd>), expanded on demand.
- **Links** inside the document, with **Back/Forward** (<kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>).
- **Find** (<kbd>Ctrl/⌘</kbd>+<kbd>F</kbd>, <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd>), selectable text.
- **Page jump** (type a number), <kbd>Home</kbd>/<kbd>End</kbd>, <kbd>n</kbd>/<kbd>p</kbd>.
- **Zoom**: toolbar, <kbd>Ctrl/⌘</kbd>+<kbd>+</kbd>/<kbd>-</kbd>/<kbd>0</kbd>, <kbd>Ctrl/⌘</kbd>+scroll or pinch; fit page or width.

The viewer remembers your page and zoom, and it reloads in place when the file changes. To use it for every PDF, run *Reopen Editor With… → Configure default editor for '\*.pdf'* → *PDF Viewer (Canvas)*.

### Interactions

| Action | How |
| --- | --- |
| Pan | Scroll / two-finger drag, drag empty space, middle-drag, or <kbd>Space</kbd>+drag |
| Zoom | <kbd>Ctrl/⌘</kbd>+scroll, pinch, <kbd>+</kbd> / <kbd>-</kbd>, toolbar |
| Fit / 100% | <kbd>Shift</kbd>+<kbd>1</kbd> / <kbd>Shift</kbd>+<kbd>0</kbd> |
| Select | Click; <kbd>Shift</kbd>+click to add; <kbd>Shift</kbd>+drag for box select; <kbd>⌘/Ctrl</kbd>+<kbd>A</kbd> |
| Move / resize | Drag a node / drag its bottom-right corner; arrow keys nudge |
| **Connect** | Drag from a side handle onto another node. Drop on empty space to create a connected note |
| New note | The toolbar |
| Edit | Double-click a note (<kbd>Esc</kbd> or <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> to finish); double-click a group title or edge to label it |
| Open | Double-click a file node (opens beside; PDFs open in the [PDF viewer](#pdf-viewer)) or a link node (opens the browser) |
| Add files | <kbd>⌥⌘P</kbd> / <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> to fuzzy-find a workspace file (like Quick Open); Toolbar → File; or right-click files in the Explorer → **Add to Canvas** |
| Paste | URLs become link nodes, text becomes notes; copy/paste and <kbd>⌘/Ctrl</kbd>+<kbd>D</kbd> duplicate nodes |
| Color | Toolbar color button: the 6 spec presets or a custom hex |
| Delete | <kbd>Delete</kbd> / <kbd>Backspace</kbd> (also removes attached edges) |
| Note → Markdown file | Select notes and click the toolbar's *Save as Markdown file* button (file with arrow) |

### Vault

File paths are stored relative to the **vault**, like in Obsidian. When resolving them, Canvas also tries the canvas's own folder and absolute paths.

| Setting | Default | Meaning |
| --- | --- | --- |
| `canvas.vault` | workspace folder | Folder where canvas files live. Absolute, `~/…`, or relative to the workspace folder. Run **Canvas: Select Vault Folder** to pick it. |
| `canvas.notesFolder` | vault root | Subfolder of the vault where note files are created, e.g. `notes`. |
| `canvas.newNoteFormat` | `text` | `text` keeps new notes inside the `.canvas` file. `markdownFile` saves each new note as a Markdown file in the vault once you finish writing it, and links the canvas to that file. |

A note file is named after the note's first line (`# My idea` → `My idea.md`; `My idea 1.md` if that name is taken). The node keeps its position, size, color and connections. Double-click it to edit the file.

If a file is not valid JSON Canvas, Canvas shows the spec violations and a button to open the file as text instead of rewriting it. Unknown properties are preserved, so files from other tools round-trip unchanged.

Use **Canvas: New Canvas** from the command palette or the Explorer context menu to create a canvas.

## Development

```sh
npm install
npm run build          # bundle extension, webview, pdf worker into dist/
npm run watch
npm test               # typecheck + lint + unit tests (Vitest)
npm run test:webview   # webview tests in headless Chromium (Playwright)
npm run test:integration   # runs inside a downloaded VS Code
npm run dev:harness    # run the webview in a normal browser with fixture data
./validation.sh        # everything CI runs on pull requests, from a clean npm ci
```

Press <kbd>F5</kbd> to launch an Extension Development Host with `test/fixtures` open. Open `sample.canvas` there.

### Layout

```
src/shared/      spec model, shared by host + webview, fully unit-tested
  types.ts         JSON Canvas 1.0 types
  validate.ts      validation, parse/normalize/serialize
  operations.ts    pure immutable edits (add/move/resize/remove/connect/duplicate…)
  geometry.ts      anchors, bezier edges, viewport math, hit testing
  fileKinds.ts     file → renderer mapping, markdown subpath slicing
  protocol.ts      host ↔ webview messages
  pdfProtocol.ts   host ↔ PDF viewer messages (byte-range streaming)
src/extension/   CustomTextEditorProvider (document sync, file resolution, watchers)
  pdfEditor.ts     read-only PDF viewer editor; serves byte ranges from disk
src/webview/     the canvas UI (vanilla TS + DOM/SVG, marked, highlight.js, pdf.js)
  pdfViewer/       the PDF viewer (pdf.js PDFViewer + toolbar, outline, history)
test/unit/       Vitest spec + model tests
test/integration/ VS Code extension tests
test/fixtures/   sample canvas and files
dev/harness.html browser harness that mocks the VS Code API
dev/pdf-harness.html  the same for the PDF viewer (?src=<pdf url>)
```

## Packaging & publishing

```sh
./package.sh                 # tests + production build → canvas-<version>.vsix
code --install-extension canvas-<version>.vsix
```

Releases are published to the Visual Studio Marketplace by `.github/workflows/release.yml` when a `v*` tag is pushed. It authenticates with OpenID Connect (trusted publishing), so there is no token to store:

1. Create a publisher at <https://marketplace.visualstudio.com/manage> and set it: `npm pkg set publisher=<id>`.
2. In the publisher settings, add this GitHub repository and workflow as a trusted publisher (see <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>).
3. Release: `npm version patch && git push --follow-tags`.
