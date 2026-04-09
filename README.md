# Python Canvas

A simple online Python IDE built with Next.js. It runs Python entirely in the browser with Pyodide, uses a touch-friendly CodeMirror editor, and supports basic `input()` programs through an in-page console.

## Run locally

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000`.

## What it includes

- Python syntax highlighting
- Run, stop, and reset controls
- Browser-side execution with Pyodide
- Terminal-style output
- `input()` support for small console programs
- Local autosave between refreshes

## Notes

- This project is designed for simple single-file scripts.
- It does not include pip/package installation, files, or multi-file projects.
- The app sets cross-origin isolation headers because the stdin bridge uses `SharedArrayBuffer`.
