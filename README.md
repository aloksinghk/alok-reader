# Alok Reader v2

This version changes the core experience from a PDF viewer to a Kindle-style reflowable reader.

## What it does

- Imports text-based PDFs
- Extracts text using PDF.js
- Converts the extracted text into reflowable paragraphs/headings
- Kindle-like reading screen
- Serif/Sans/Book font choices
- Font size controls
- Light/Sepia/Dark/Black themes
- Line spacing
- Reading width
- Search inside book
- Reading progress
- Bookmarks
- Original PDF fallback
- Responsive desktop/mobile UI
- Local-first IndexedDB storage

## Run

From this folder:

```bash
python -m http.server 8080
```

Open:

`http://localhost:8080`

## Important limitation

The extraction heuristic is intentionally simple in this MVP. PDFs with complex columns, tables, scanned pages, or unusual text ordering may not convert perfectly.

Next production phase:
- robust PDF extraction
- chapter detection
- EPUB import
- cloud account/storage
- cross-device sync
- highlights and notes
- automatic covers and metadata
- Android APK / iOS PWA

## v2.1 bug fix

Fixed a JavaScript template-string syntax error that prevented the application event handlers from loading. Also added cache busting/service-worker cleanup so the corrected version is loaded.

## v2.2 — Kindle-style pagination

The reader now uses horizontal paginated columns instead of continuous vertical scrolling. It supports:
- one-page-at-a-time horizontal reading
- previous/next page buttons
- keyboard left/right and PageUp/PageDown
- mobile swipe left/right
- page indicator
- page-based progress
- automatic re-pagination when screen size or font settings change

## v2.4 — Native file picker

The Add Books sidebar item is now a native HTML `<label for="fileInput">`. This removes the dependency on a JavaScript click handler for opening the Windows/Edge file picker. The import handler is also exposed globally.

## v2.5 — startup robustness

- Native Add Books file picker
- Restored previous/next page controls
- Optional reader controls are null-safe
- Cache version bumped

## v2.6 — Layout-aware PDF extraction

The previous extractor concatenated PDF text fragments in raw order, which can create glued words and broken reading order. v2.6 reconstructs lines from PDF X/Y coordinates, restores spaces between positioned fragments, and detects paragraph breaks from vertical spacing. Existing books are automatically reprocessed the first time they are opened.

## v2.9 — Reading controls and performance

- Faster book opening: old extracted books are no longer reprocessed automatically on every open.
- Single-page and two-page spread modes are fully implemented.
- Font selection: Serif, Sans, Book.
- Themes: Light, Sepia, Dark, Black.
- Text size, line spacing, and text width.
- Settings panel now shows the active selection.
- Two-page spread is automatically reduced to single-page on narrow/mobile screens.
- Pagination uses binary-search chunking for much faster page construction.

## v2.10 — Fixed navigation and two-page spread
- Next/previous no longer gets reset by the scroll handler while smooth-scrolling.
- Two-page spread is built as real paired physical pages.
- Single-page and spread use the same physical-page model.
- Page labels and progress are updated immediately when navigation is clicked.

## v2.10.1 — navigation event fix
Fixed the scroll listener calling the old pagination function, which could reset Next/Previous immediately after a click. Layout selection now resets to the first spread and closes the settings panel after applying the new layout.

## v2.11 — Reader page count fix

The reader now uses an off-screen page with the same typography to measure paragraph chunks. This prevents the pagination engine from incorrectly treating a long reflowable book as only one or two pages. PDF page count and reflowed reader page count are now displayed separately.

## v2.12 — Deterministic reader pagination

The reader no longer relies on horizontal scroll position to determine the current page. It builds a persistent array of reflowed reader pages, renders only the current page/spread, and stores the physical reader page. Next/Previous cannot stop at an arbitrary scroll position. Switching Single Page ↔ Two-page Spread preserves the current physical reading position instead of resetting to page 1.

## v2.12.1 — Spread width correction

Fixed legacy CSS that was applying large side padding to spread pages, making the text column unnecessarily narrow. Two-page spread now uses the available half-screen width with normal book margins. Also removed a duplicate legacy layout handler that could reset the reader position.

## v2.13 — Table of Contents and chapter navigation

Added a Kindle-style Contents panel. Chapter/part/section headings detected during text extraction are mapped to their reflowed reader pages. Users can open Contents from the reader toolbar and jump directly to a chapter. The current physical page is preserved when switching layouts.

## v2.14 — Bookmarks and reading progress

Added exact reader-page bookmarks, a bookmark list, bookmark toggle, keyboard shortcut B, and persistent bookmark storage per book. The reading progress indicator now includes percentage and an estimated remaining reading time based on the extracted word count.

## v2.14.1 — Library/upload regression fix

Fixed a naming collision where the reader's bookmark-panel renderer overwrote the library's Bookmarks screen renderer. This could stop the library from rendering and make the Add PDF workflow appear unavailable. Also bumped the service-worker cache version.

## v2.15 — Highlights & Notes

Added text selection actions for Highlight and Note. Highlights are stored per book with the exact reflowed reader page and selected text, are reapplied after pagination/layout changes, and appear in the main Highlights screen. Notes are attached to individual highlights and can be opened from the Highlights screen.

## v2.15.1 — Reader footer and narrow-screen fix

Fixed the reader progress footer so page numbers and percentage stay on one line instead of wrapping vertically. Added responsive behavior for narrow/mobile screens so a saved two-page layout automatically behaves as single-page while the viewport is narrow, preventing text from being pushed off-screen. The saved layout preference is not changed.

## v2.15.2 — Highlight engine fix

Improved highlight restoration by storing text offsets and applying highlights directly to rendered text ranges. Existing highlights remain supported through fallback matching.
