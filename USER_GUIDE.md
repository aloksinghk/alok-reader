# Alok Reader — User Guide

**Version 3.3**

---

## What is Alok Reader?

Alok Reader is a personal reading app that runs entirely in your browser. Upload any text-based PDF and it converts it into a clean, comfortable reading experience — like a Kindle, but for your own books. Everything is stored locally on your device. There is no account, no subscription, and no data ever leaves your browser.

---

## Getting Started

### Running the app

Alok Reader is a PWA (Progressive Web App). To run it locally:

```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .
```

Then open `http://localhost:8080` in your browser.

You can also install it as a desktop/mobile app: look for the **Install** button in your browser's address bar after opening the app.

### Adding your first book

1. Click **＋ Add Books** in the left sidebar, or drag and drop a PDF anywhere onto the upload zone.
2. Alok Reader will extract the text from the PDF. A progress indicator shows the current page being processed.
3. Once done, the book appears in your library with the title and author auto-detected from the PDF's metadata.

> **Note:** Alok Reader works best with text-based PDFs. Scanned documents (image-only PDFs) will not extract readable text.

---

## Reading a Book

Click any book cover to open it in the reader.

### Turning pages

| Action | Result |
|--------|--------|
| Click `›` / `‹` buttons | Next / previous page |
| `→` or `PageDown` key | Next page |
| `←` or `PageUp` key | Previous page |
| Swipe left / right (touch) | Next / previous page |
| Progress slider (bottom bar) | Jump to any position |

### Reader toolbar (top bar)

| Button | Function |
|--------|----------|
| `←` | Close reader, return to library |
| `☰` | Table of contents |
| `🔖` (outline) | Bookmarks panel |
| `☆` / `★` | Bookmark / unbookmark current page |
| `⌕` | Search within the book |
| `Aa` | Reading settings |
| `PDF` | View the original PDF |

### Keyboard shortcuts

Press **`?`** while reading to see all shortcuts.

| Key | Action |
|-----|--------|
| `←` / `PageUp` | Previous page |
| `→` / `PageDown` | Next page |
| `f` | Open search |
| `t` | Table of contents |
| `b` | Bookmark current page |
| `?` | Keyboard shortcuts overlay |
| `Escape` | Close reader / close open panels |

---

## Reading Settings

Click **Aa** in the top bar or bottom bar to open reading settings.

### Font

| Option | Font used |
|--------|-----------|
| Serif | Playfair Display — elegant, book-like |
| Sans | Nunito — clean, modern |
| Book | Palatino — classic long-read feel |
| ✍ Hand | Caveat — relaxed handwriting style |

### Text size

Use **A−** and **A+** to decrease or increase the font size (14px – 30px).

### Theme

| Theme | Best for |
|-------|----------|
| Light | Bright rooms, daytime reading |
| Sepia | Warm, paper-like feel |
| Dark | Low-light environments |
| Black | OLED screens, maximum darkness |
| Forest | Green-tinted night mode |

### Line spacing

- **Compact** — more text per page
- **Normal** — balanced default
- **Spacious** — more breathing room between lines

### Layout

- **Single** — one page at a time
- **Two-page** — side-by-side spread (best on wide screens)

### Text width

- **Narrow** — tighter column, easier on wide monitors
- **Normal** — default width
- **Wide** — maximise screen space

---

## Highlights & Notes

### Creating a highlight

1. Select any text on the page by clicking and dragging.
2. A menu appears to the right of your selection with:
   - **5 colour swatches** (yellow, green, blue, pink, orange) — click to choose your colour
   - **🖊 Highlight** — save the highlight in the selected colour
   - **📝 Add Note** — save a highlight with a personal note attached
3. The highlighted text turns the chosen colour immediately.

### Dictionary lookup

When you select a **single word**, a **📖 Define** option appears at the bottom of the selection menu. Click it to look up the word's definition, phonetic, and example sentences. An audio pronunciation button (🔊) appears if audio is available.

The dictionary uses [Free Dictionary API](https://api.dictionaryapi.dev) with automatic fallback to [Datamuse](https://api.datamuse.com) if the primary source is unavailable. An internet connection is required for lookups.

### Viewing all highlights

Click **🖊 Highlights** in the sidebar to see all your highlights and notes across every book. Each entry shows:
- The book title
- The highlighted text (with colour indicator)
- Your note (if any)
- The page number

Click **Open** to jump directly to that page in the reader.

---

## Bookmarks

### Adding a bookmark

- Click **☆** in the reader top bar, or press **`b`**.
- The star turns gold (★) to confirm the bookmark was saved.
- Click again to remove the bookmark.

### Viewing bookmarks

- Click **🔖** in the reader top bar to open the bookmarks panel (slides in from the left).
- Click any bookmark to jump to that page.
- Click **🔖 Bookmarks** in the sidebar to see all bookmarks across your entire library.

---

## Search

Press **`f`** or click the **⌕** button while reading to open the search bar.

- Type any word or phrase to find all matches in the current book.
- Matches are highlighted in yellow and the page count is shown.
- Clear the search to return to normal reading.

---

## Table of Contents

Click **☰** in the reader top bar (or press **`t`**) to open the contents panel.

- Chapters are detected from the PDF's built-in outline when available.
- Falls back to heading detection in the extracted text.
- Click any chapter to jump directly to it.

---

## Deleting a Book

1. In the library, hover over a book cover — a **🗑** icon appears in the top-right corner.
2. Click the icon — a confirmation dialog appears with the book title.
3. Click **Yes, delete** to permanently remove the book, including all highlights and bookmarks.
4. Click **Cancel** or press **Escape** to dismiss without deleting.

> **This action cannot be undone.** Export a backup first if you want to preserve highlights and notes.

---

## Backup & Restore

Go to **⚙ Settings & Backup** in the sidebar.

### Export backup

Click **⬇ Export backup** to download a `.json` file containing:
- All your books (title, author, reading progress, page position)
- All highlights with colours and notes
- All bookmarks
- The full book text as Markdown and HTML

The original PDF binary is not included in the backup (it would make the file very large). Re-upload the original PDFs after restoring.

### Import backup

Click **⬆ Import backup** and select a previously exported `.json` file.

- Books are merged by ID — existing books are updated with the backup data
- New books from the backup are added to your library
- Existing PDF binaries are preserved (not overwritten)
- A toast notification confirms how many books were added or updated

### Export highlights as Markdown

Click **📝 Export highlights (.md)** to download all highlights across all books as a single Markdown file. Useful for note-taking apps like Obsidian, Notion, or Bear.

### Moving to another device

1. Export backup on the original device → saves `alok-reader-backup-YYYY-MM-DD.json`
2. Open Alok Reader on the new device
3. Import backup → all your reading progress, highlights and bookmarks are restored
4. Re-upload your original PDFs to restore the "View original PDF" feature

---

## Tips & Tricks

**Re-import the same PDF?** Alok Reader won't duplicate it — if the book ID already exists in the backup, it updates the record instead of creating a new one.

**Lost your place?** Reading progress is saved automatically every time you turn a page. If you close the browser, it reopens exactly where you left off.

**Book covers look wrong?** The cover colour is assigned automatically based on the book's position in the grid. It's decorative — the title is always shown on the cover.

**PDF text garbled?** Some PDFs use non-standard encodings or ligatures. Try opening the original PDF view (PDF button in the reader) to compare. Complex academic papers, scanned books, or PDFs with custom fonts may not extract perfectly.

**Two-page spread cut off on mobile?** Two-page spread is designed for wide screens (> 700px). On mobile it automatically reverts to single-page mode.

---

## Privacy

- All data is stored in your browser's **IndexedDB** — no server involved.
- Backup files are stored wherever you save downloads on your device.
- Dictionary lookups send only the looked-up word to `api.dictionaryapi.dev` and `api.datamuse.com` — no book content, no user data.
- The app can be used completely offline after the first page load (excluding dictionary lookups and PDF.js if not yet cached).

---

## Supported Browsers

| Browser | Status |
|---------|--------|
| Chrome / Edge (latest) | Fully supported |
| Firefox (latest) | Fully supported |
| Safari 16+ | Fully supported |
| Mobile Chrome / Safari | Supported (single-page mode recommended) |
| IE / Legacy Edge | Not supported |

---

## Troubleshooting

**Book shows "No readable text was extracted"**  
The PDF is likely scanned (image-based). Alok Reader cannot extract text from images. Use a separate OCR tool to create a searchable PDF first.

**Highlights not appearing after re-opening**  
This can happen if the book was imported before v3.0 without `data-pid` attributes. Try scrolling to the page with highlights — they apply when the page renders.

**Dictionary says "No definition found"**  
Try selecting just the base form of the word (e.g., "run" instead of "running"). Proper nouns and specialised terms may not be in the dictionary.

**Reader is blank / app doesn't load**  
Hard refresh with `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac) to bypass the service worker cache and load the latest version.

**Progress bar shows wrong page count**  
Page count is dynamic — it depends on your current font size and window size. Changing font size or resizing the window will re-paginate the book.
