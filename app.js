/**
 * app.js — Alok Reader v2 (kiro-improvements)
 *
 * Thin orchestrator. All logic lives in src/ modules:
 *   src/db.js          — IndexedDB CRUD
 *   src/extractor.js   — PDF.js text/metadata/outline extraction
 *   src/paginator.js   — reflowable page building
 *   src/highlights.js  — highlight storage & DOM application
 *   src/library.js     — library-screen renderers
 *   src/reader.js      — reader UI, navigation, settings
 *   src/utils.js       — shared helpers
 */

import { openDB, getAllBooks, putBook, deleteBook } from './src/db.js';
import { extractPdf, paragraphsFromText }           from './src/extractor.js';
import { openBook, initReader }                     from './src/reader.js';
import {
  renderLibrary,
  renderCollections,
  renderBookmarks,
  renderHighlights,
  renderUpload,
} from './src/library.js';
import { uid, $, showToast, setLoading, setLoadingMessage } from './src/utils.js';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let books  = [];
let screen = 'library';
let query  = '';

// ---------------------------------------------------------------------------
// Render dispatcher
// ---------------------------------------------------------------------------

function render() {
  const names = {
    library:     'Home',
    collections: 'Collections',
    bookmarks:   'Bookmarks',
    highlights:  'Highlights',
    upload:      'Add Books',
  };
  $('#topTitle').textContent = names[screen] || 'Home';
  document.querySelectorAll('.nav-item').forEach(x =>
    x.classList.toggle('active', x.dataset.screen === screen)
  );

  const renderers = {
    library:     () => renderLibrary({
      books,
      query,
      onOpen:     handleOpenBook,
      onAddBooks: openFilePicker,
    }),
    collections: () => renderCollections({ books }),
    bookmarks:   () => renderBookmarks({
      books,
      onOpen: (id, page) => handleOpenBook(id, page),
    }),
    highlights:  () => renderHighlights({
      books,
      onOpen: (id, page) => handleOpenBook(id, page),
    }),
    upload:      () => renderUpload({ onAddBooks: openFilePicker }),
  };

  (renderers[screen] || renderers.library)();
}

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

function openFilePicker() {
  const input = $('#fileInput');
  if (input) { input.value = ''; input.click(); }
}

async function handleFiles(list) {
  const files = [...list].filter(f =>
    f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (!files.length) return;

  for (const f of files) {
    setLoading(true, `Importing "${f.name}" (1 / ${files.length})…`);
    try {
      const extracted = await extractPdf(
        f,
        f.name,
        (current, total) => setLoadingMessage(
          `Extracting "${f.name}" — page ${current} of ${total}…`
        )
      );

      const book = {
        id:                uid(),
        name:              f.name,
        title:             extracted.title,
        author:            extracted.author,
        size:              f.size,
        data:              await f.arrayBuffer(),
        text:              extracted.text,
        html:              extracted.html,
        outline:           extracted.outline,
        totalPages:        extracted.pages,
        lastPage:          1,
        progress:          0,
        bookmarks:         [],
        highlights:        [],
        created:           Date.now(),
        extractionVersion: '3.0',
      };
      await putBook(book);
      showToast(`"${extracted.title}" added to your library.`, 'success');
    } catch (err) {
      console.error('Import failed', f.name, err);
      showToast(`Could not import "${f.name}": ${err.message}`, 'error');
    }
  }

  setLoading(false);
  books  = await getAllBooks();
  screen = 'library';
  render();
}

// ---------------------------------------------------------------------------
// Open a book in the reader
// ---------------------------------------------------------------------------

async function handleOpenBook(id, startPage = null) {
  const book = books.find(b => b.id === id);
  if (!book) return;

  // Legacy books imported before v3 don't have .html — regenerate from .text
  if (!book.html && book.text) {
    setLoading(true, 'Preparing book…');
    try {
      book.html = paragraphsFromText(book.text);
      await putBook(book);
    } catch (err) {
      console.error('HTML regeneration failed', err);
    }
    setLoading(false);
  }

  await openBook(book, startPage, async () => {
    // Called when reader closes
    books = await getAllBooks();
    render();
  });
}

// ---------------------------------------------------------------------------
// Nav wiring
// ---------------------------------------------------------------------------

document.querySelectorAll('.nav-item[data-screen]').forEach(nav => {
  nav.addEventListener('click', e => {
    e.preventDefault();
    screen = nav.dataset.screen || 'library';
    $('#sidebar').classList.remove('open');
    render();
  });
});

$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');

$('#globalSearch').oninput = e => {
  query  = e.target.value;
  screen = 'library';
  render();
};

$('#fileInput')?.addEventListener('change', e => handleFiles(e.target.files));

// Drop zone at the document level
document.addEventListener('files-dropped', e => handleFiles(e.detail.files));

// ---------------------------------------------------------------------------
// Init reader + boot
// ---------------------------------------------------------------------------

initReader();

(async () => {
  try {
    await openDB();
    books = await getAllBooks();
  } catch (err) {
    console.error('DB init failed', err);
    showToast('Storage error. Your books may not be available.', 'error');
  }
  render();
})();
