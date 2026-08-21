# Alok Reader — Design Document

**Version:** 3.3 (kiro-improvements branch)  
**Last updated:** August 2026  
**Stack:** Vanilla JS (ES Modules), CSS3, IndexedDB, PDF.js 4.4, Service Worker

---

## 1. Purpose & Goals

Alok Reader is a **local-first, privacy-preserving PDF reader** that runs entirely in the browser. There is no server, no account, no tracking. Every byte of your library lives in your browser's IndexedDB.

Core goals:
- Convert text-based PDFs into a comfortable, Kindle-style reflowable reading experience
- Work fully offline after first load (PWA + Service Worker)
- Be fast and lightweight — no framework, no bundler, no build step
- Preserve reading progress, highlights, bookmarks and notes across sessions

---

## 2. Architecture Overview

```
alok-reader/
├── app.js                  ← Thin orchestrator (entry point, ~120 lines)
├── index.html              ← Single-page shell with all overlays
├── styles.css              ← Consolidated stylesheet (no versioned patches)
├── sw.js                   ← Service Worker (cache-first, v3-1-0)
├── manifest.webmanifest    ← PWA manifest
└── src/
    ├── db.js               ← IndexedDB CRUD layer
    ├── extractor.js        ← PDF.js text/metadata/outline extraction
    ├── paginator.js        ← Reflowable page builder
    ├── highlights.js       ← Highlight storage, DOM application
    ├── library.js          ← Library screen renderers
    ├── reader.js           ← Reader UI, navigation, settings, keyboard
    ├── backup.js           ← Export/import backup (JSON + Markdown)
    ├── dictionary.js       ← Free Dictionary API popup
    └── utils.js            ← Shared helpers (toast, loading, escapeHtml)
```

### Module dependency graph

```
app.js
  ├── src/db.js
  ├── src/extractor.js
  ├── src/reader.js
  │     ├── src/paginator.js
  │     ├── src/highlights.js
  │     ├── src/dictionary.js
  │     ├── src/db.js
  │     └── src/utils.js
  ├── src/library.js
  │     └── src/utils.js
  ├── src/backup.js
  │     ├── src/db.js
  │     └── src/utils.js
  └── src/utils.js
```

No circular dependencies. `app.js` is the only module that imports from both `reader.js` and `library.js`.

---

## 3. Data Model

### Book record (stored in IndexedDB `books` store, key: `id`)

```js
{
  id:                string,      // crypto.randomUUID()
  name:              string,      // original filename
  title:             string,      // from PDF metadata or filename
  author:            string,      // from PDF metadata or ''
  size:              number,      // file size in bytes
  data:              ArrayBuffer, // raw PDF binary (excluded from backup)
  text:              string,      // plain text extracted from PDF
  html:              string,      // paragraphs/headings as HTML string
  outline:           Array,       // resolved PDF outline [{title, page, depth}]
  totalPages:        number,      // PDF page count
  lastPage:          number,      // last physical reader page (1-based)
  readerPage:        number,      // last physical reader page (0-based index)
  progress:          number,      // 0.0–1.0
  bookmarks:         Array,       // [{page, label, createdAt}]
  highlights:        Array,       // see Highlight record below
  font:              string,      // 'serif'|'sans'|'book'|'hand'
  fontSize:          number,      // 14–30 (px)
  lineHeight:        number,      // 1.35|1.6|1.9
  theme:             string,      // 'light'|'sepia'|'dark'|'black'|'forest'
  layout:            string,      // 'single'|'spread'
  textWidth:         number,      // 660|820|1020 (px)
  created:           number,      // Date.now()
  extractionVersion: string,      // '3.1'
}
```

### Highlight record

```js
{
  id:               string,   // uid()
  page:             number,   // physical page index (0-based), spread-aware
  text:             string,   // selected text (whitespace normalised)
  note:             string,   // optional user note
  color:            string,   // 'yellow'|'green'|'blue'|'pink'|'orange'
  paragraphId:      string,   // data-pid of the source paragraph
  startInParagraph: number,   // char offset from paragraph start
  endInParagraph:   number,   // char offset from paragraph end
  sectionStart:     number,   // char offset from .book-page section start
  sectionEnd:       number,   // char offset from .book-page section end
  createdAt:        string,   // ISO timestamp
}
```

Highlights use a three-path re-application strategy:
1. **paragraphId + intra-paragraph offsets** — survives font/size changes
2. **sectionStart/sectionEnd** — fallback if paragraph ID shifts
3. **text-search** — last resort, whitespace-normalised substring match

---

## 4. PDF Extraction Pipeline

```
File → PDF.js getDocument() → per-page getTextContent()
     → line reconstruction from X/Y transform coordinates
     → space restoration between adjacent fragments
     → paragraph break detection from vertical gap ratio
     → doc.getMetadata()  → title, author
     → doc.getOutline()   → resolve dest[] to 1-based page numbers
     → paragraphsFromText() → <p data-pid="p0"> / <h2 data-pid="p1">
     → stored as book.html
```

Each paragraph gets a stable `data-pid` attribute (sequential `p0`, `p1`, …) used as the anchor for highlight storage.

Heading detection uses a scoring heuristic:
- `chapter N` / `part N` keyword patterns
- Known section keywords (Preface, Introduction, etc.)
- All-caps, length 5–90 chars

---

## 5. Pagination Engine (`paginator.js`)

The paginator produces a `string[]` of HTML pages from the book's raw HTML.

**Algorithm:**
1. Create an off-screen `measure-page` div with identical typography settings (font, size, line-height, width, padding)
2. For each source paragraph/heading node:
   - If `node.outerHTML` fits on the current page → append
   - If it doesn't fit → commit current page, start a new one
   - If the node is a `<p>` that is too long even alone → binary-search split by word count
3. Chapter headings are kept with at least one following paragraph (widowed heading prevention)

The paginator also builds the `chapters[]` array from:
- PDF outline (preferred — exact page numbers from `doc.getOutline()`)
- Heading text detected in the paginated pages (fallback)

Pagination is triggered on:
- Book open
- Font family/size change
- Line height change
- Text width change
- Layout (single/spread) toggle

---

## 6. Reader Navigation

Physical page vs. unit page:

| Mode   | Physical page | Unit (displayed) |
|--------|--------------|-----------------|
| Single | N            | N               |
| Spread | N (always even) | N / 2        |

`readerPhysicalPage` is always the left/only page. `getUnitIndex()` converts to the displayed page number. `getUnitCount()` gives the total number of turns.

Progress is stored as `progress = readerPhysicalPage / (totalPages - 1)` — a 0–1 float.

---

## 7. Highlight Event Architecture

Text selection → highlight flow:

```
mouseup on #readingText
  → setTimeout(openSelectionMenu, 0)     [escape mousedown cycle]
  → getActiveSelection()                 [capture range + offsets]
  → render vertical menu (swatches + actions)

click on Highlight button
  → mousedown: e.preventDefault() + e.stopPropagation()
  → click: createHighlightFromSelection()
      → createHighlightRecord(selection, page, note, color)
      → putBook(current)                 [persist to IndexedDB]
      → renderReaderPage()               [clean DOM re-render]
          → applyStoredHighlights()      [re-apply all highlights]

click on Define button
  → click: showDictionary(word, rect)    [called from click, not mousedown]
      → renders loading state
      → open(anchorRect)                 [display:block + rAF-deferred outside-click]
      → fetchFreeDictionary() || fetchDatamuse()
      → renders result
```

Key design rule: **the dictionary is only ever opened from a `click` handler**, never from `mousedown`. This ensures all `mousedown` side effects (clearing `activeSelection`, closing menus) have already completed before the popup appears.

---

## 8. Spread Layout & Highlights

In spread mode, two `.book-page` sections are rendered:
- `sections[0]` = physical page `readerPhysicalPage` (left)
- `sections[1]` = physical page `readerPhysicalPage + 1` (right)

`getActiveSelection()` detects which section the selection is in via `allSections.indexOf(section)` → `sectionIndex`. `createHighlightRecord` stores `page = readerPhysicalPage + sectionIndex` so right-page highlights are saved with the correct physical page number.

`applyStoredHighlights` maps `hPage === physicalPage + i` → `sections[i]`, which correctly handles both single and spread mode.

---

## 9. Backup Format

```json
{
  "version": 3,
  "exportedAt": "2026-08-20T...",
  "appName": "Alok Reader",
  "books": [
    {
      "id": "...",
      "title": "...",
      "author": "...",
      "progress": 0.42,
      "readerPage": 53,
      "bookmarks": [...],
      "highlights": [...],
      "outline": [...],
      "md": "# Title\n\n...",   ← full book as Markdown
      "html": "<p>...</p>"      ← full book as HTML
    }
  ]
}
```

The raw PDF `ArrayBuffer` (`book.data`) is intentionally excluded — it would make the backup file enormous. Re-import the original PDFs after restoring to restore the "View original PDF" functionality.

Import merges by `book.id`: existing records are updated, new ones are inserted. Existing PDF binaries are never overwritten.

---

## 10. Service Worker Strategy

Cache name: `alok-reader-v3-1-0`

Strategy: **cache-first with network fallback**

Precached at install:
- `./` `index.html` `styles.css` `app.js` `manifest.webmanifest`
- All `src/*.js` modules (including `backup.js`, `dictionary.js`)

PDF.js is loaded dynamically from CDN (not precached). The app works fully offline for all reading/annotation features. Dictionary lookup requires an internet connection.

---

## 11. Design System

### Color palette

| Token            | Value     | Usage                          |
|-----------------|-----------|-------------------------------|
| `--bg`          | `#FFFDF7` | App background (warm cream)    |
| `--panel`       | `#FFFFFF` | Cards, popovers                |
| `--ink`         | `#1A1A2E` | Primary text                   |
| `--accent`      | `#F5A623` | CTA buttons, active states     |
| `--accent-dark` | `#D4891A` | Hover variant                  |
| `--sidebar-bg`  | `#1A1A2E` | Sidebar, reader chrome         |
| `--line`        | `#EDE8DC` | Borders, dividers              |
| `--muted`       | `#8A8AA0` | Secondary text                 |

### Typography

| Font             | Weight    | Usage                        |
|-----------------|-----------|------------------------------|
| Nunito           | 400–800   | UI labels, buttons, nav      |
| Playfair Display | 700       | Hero headlines, serif reading |
| Caveat           | 400–700   | Handwriting font option      |
| Inter            | 400–700   | Sans reading fallback        |
| Palatino         | 400       | Book reading option          |

### Reader themes

| Theme   | Background | Text       | Accent       |
|---------|-----------|------------|--------------|
| Light   | `#FAFAF5` | `#1A1A2E`  | `#D4891A`    |
| Sepia   | `#F5EDD6` | `#2C1F0A`  | `#A0522D`    |
| Dark    | `#1C1C2E` | `#D8D8E8`  | `#F5A623`    |
| Black   | `#000000` | `#CCCCCC`  | `#F5A623`    |
| Forest  | `#1A2818` | `#CEEACC`  | `#7BC97B`    |

---

## 12. Known Limitations

| Area | Limitation |
|------|-----------|
| PDF extraction | Heuristic-based; multi-column, tables, scanned PDFs degrade gracefully but won't be perfect |
| Pagination | Runs synchronously on the main thread; very large books (500+ pages) may pause briefly |
| PDF.js | Loaded from CDN on first use; offline first use requires network |
| Highlights | Cross-page selections (spanning a page break) are not supported |
| EPUB | Not yet supported |
| Cloud sync | Not yet supported — local-first only |
| Mobile | Fully responsive; text selection on iOS has browser-specific quirks |

---

## 13. Future Roadmap

- [ ] EPUB import (EPUBs have clean semantic structure, superior to PDF extraction)
- [ ] Web Worker for pagination (remove main thread block)
- [ ] Chapter detection improvement (font-size from PDF.js transform matrix)
- [ ] Highlights export per-book to Markdown
- [ ] Reading statistics (pages/day chart)
- [ ] Native app packaging (Tauri or PWA installation prompt)
- [ ] Cloud sync option (optional, bring-your-own storage)
