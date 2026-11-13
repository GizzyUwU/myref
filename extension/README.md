# MyRef Browser Extension

Works **fully offline** in the browser. Optionally syncs with your MyRef server.

TypeScript sources in `src/` build to `dist/` with `tsc` (no bundler — the
popup and service worker load the emitted ES modules directly).

## Build

```sh
# from the repo root (extension is a bun workspace)
bun install
bun run build:extension   # runs tsc in extension/, emits dist/

# or inside extension/
bun run build             # tsc -p tsconfig.json
bun run typecheck         # tsc --noEmit
```

`dist/` is committed (see the `!/extension/dist/` exception in `.gitignore`)
so the extension can be loaded unpacked without a build step. Rebuild after
any change under `src/`.

## Features (client-side, no server needed)

- Projects: create, rename, delete (stored in `chrome.storage.local`, falls back to `localStorage`)
- References: all 9 types (book, chapter, journal, website, report, thesis, newspaper, film, other) with authors/editors, year, container, publisher, place, edition, volume, issue, pages, DOI, URL, accessed date, publication date, notes, tags
- Search across title/author/DOI/tag, filter by type, sort (newest, oldest, author A–Z, publish date, title)
- Multi-select: copy bibliography for selection, duplicate into another project, bulk delete
- Import:
  - DOI via Crossref (direct `api.crossref.org` call)
  - ISBN via Open Library (direct `openlibrary.org` call)
  - **Save current tab** — extracts title/meta/author via `chrome.scripting` and creates a website reference (no CORS issues)
- **Quick-save shortcut**: `Ctrl+Shift+S` (`Cmd+Shift+S` on Mac) saves the current tab straight into the project in use — no need to open the popup. The opened project automatically becomes the quick-save target (★); change it anytime from the project header. View all shortcuts under Sync → Keyboard shortcuts, and rebind global ones at `chrome://extensions/shortcuts`
- **Popup shortcuts**: `/` focuses search, `Esc` closes dialogs / goes back
  - Raw URLs create a prefilled website draft instantly
- Bibliography rendered with **real CSL styles** (vendored citeproc engine): 6 styles work fully offline (incl. University of Northampton, APA, MLA, Chicago, IEEE, Vancouver); with a server connected you can search all 10,000+ CSL styles and they download for offline use. Per-project style picker with last-write-wins sync
- Export per project: `.txt`, `.html`, `.ris`, `.bib` (uses the project's CSL style for text/HTML)
- Full JSON backup export + wipe
- Themes: Light, Dracula, Catppuccin Macchiato, Catppuccin Mocha — same tokens as the web app, no gradients

## Optional server sync (automatic)

Connect once — the extension keeps only a revocable API token, never your
password — then sync runs automatically: on open, seconds after each change,
and every minute.

1. Set **Server URL**, e.g. `http://localhost:3000` (self-hosted).
2. Either log in with username + password (**Connect** — the password is
   exchanged for a token once and cleared), or paste a token you created
   under **Settings → API tokens** on the site (**Use key**).
3. That's it. Pulls merge server changes **without overwriting newer local
   edits** (last-write-wins per project/reference); pushes upload new and
   edited items and replay deletions both ways.

Manual **Pull from server** / **Push to server** buttons force an immediate
sync. **Disconnect** revokes the token server-side. Wiping local data only
clears this device — server copies return on the next sync unless deleted
first (delete the projects while connected and the deletions propagate).

Notes: sync needs HTTPS or `localhost` (browser cookie rules for the login
call); API tokens survive password changes and can be managed under
**Settings → API tokens** on the site.

## Load unpacked

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/`.
2. Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `extension/manifest.json`.
3. Click the toolbar icon. For **Save current tab**, allow the extension on the page when prompted.

## Files

- `manifest.json` — MV3, `storage`/`tabs`/`scripting` + `host_permissions` for self-hosted sync
- `popup.html` / `styles.css` — UI, same theme as `frontend/src/styles.css`
- `src/` — TypeScript sources: `types`, `storage`, `format`, `export`, `lookup`, `sync`, `csl` (CSL rendering), `app` (UI), `background`
- `dist/` — compiled JS loaded by the extension (checked in; rebuild with `bun run build:extension`)
- `vendor/citeproc.js` — citeproc-js bundled to a minified IIFE (checked in; regenerate with `bunx -y esbuild backend/node_modules/citeproc/citeproc_commonjs.js --bundle --minify --format=iife --global-name=CSL --outfile=extension/vendor/citeproc.js`)
- `csl/` — bundled offline styles + `locales-en-US.xml`
