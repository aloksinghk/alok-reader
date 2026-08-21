/**
 * app.js — Alok Reader v3.1
 * Thin orchestrator. Logic lives in src/ modules.
 */

import { openDB, getAllBooks, putBook, deleteBook } from './src/db.js';
import { extractPdf, paragraphsFromText }        from './src/extractor.js';
import { openBook, initReader }                  from './src/reader.js';
import {
  renderLibrary, renderCollections,
  renderBookmarks, renderHighlights, renderUpload,
} from './src/library.js';
import {
  exportBackup, importBackup, exportHighlightsAsMarkdown,
} from './src/backup.js';
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
    library:'Home', collections:'Collections',
    bookmarks:'Bookmarks', highlights:'Highlights', upload:'Add Books',
  };
  $('#topTitle').textContent = names[screen] || 'Home';
  document.querySelectorAll('.nav-item[data-screen]').forEach(x =>
    x.classList.toggle('active', x.dataset.screen === screen)
  );

  ({
    library:     () => renderLibrary({
      books, query,
      onOpen:    handleOpenBook,
      onAddBooks: openFilePicker,
      onDelete:  handleDeleteBook,
    }),
    collections: () => renderCollections({ books }),
    bookmarks:   () => renderBookmarks({ books, onOpen: handleOpenBook }),
    highlights:  () => renderHighlights({ books, onOpen: handleOpenBook }),
    upload:      () => renderUpload({
      onAddBooks:        openFilePicker,
      onExportBackup:    () => exportBackup(),
      onImportBackup:    async f => { await importBackup(f); books = await getAllBooks(); render(); },
      onExportHighlights:() => exportHighlightsAsMarkdown(),
    }),
  }[screen] || (() => renderLibrary({ books, query, onOpen: handleOpenBook, onAddBooks: openFilePicker })))();
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

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setLoading(true, `Importing ${i + 1} of ${files.length}…`);
    try {
      const extracted = await extractPdf(
        f, f.name,
        (cur, total) => setLoadingMessage(`Extracting "${f.name}" — page ${cur} of ${total}…`)
      );
      const book = {
        id:    uid(), name: f.name,
        title: extracted.title, author: extracted.author,
        size:  f.size, data: await f.arrayBuffer(),
        text:  extracted.text, html: extracted.html,
        outline: extracted.outline, totalPages: extracted.pages,
        lastPage: 1, progress: 0, readerPage: 0,
        bookmarks: [], highlights: [],
        created: Date.now(), extractionVersion: '3.1',
      };
      await putBook(book);
      showToast(`"${extracted.title}" added.`, 'success');
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
// Delete book
// ---------------------------------------------------------------------------
async function handleDeleteBook(id) {
  try {
    await deleteBook(id);
    books  = await getAllBooks();
    screen = 'library';
    render();
    showToast('Book deleted.', 'info');
  } catch (err) {
    console.error('Delete failed', err);
    showToast('Could not delete book.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Open book
// ---------------------------------------------------------------------------
async function handleOpenBook(id, startPage = null) {
  const book = books.find(b => b.id === id);
  if (!book) return;

  if (!book.html && book.text) {
    setLoading(true, 'Preparing book…');
    try { book.html = paragraphsFromText(book.text); await putBook(book); } catch {}
    setLoading(false);
  }

  await openBook(book, startPage, async () => {
    books = await getAllBooks();
    render();
  });
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item[data-screen]').forEach(nav => {
  nav.addEventListener('click', e => {
    e.preventDefault();
    screen = nav.dataset.screen || 'library';
    $('#sidebar')?.classList.remove('open');
    render();
  });
});

$('#menuBtn')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));

$('#globalSearch')?.addEventListener('input', e => {
  query = e.target.value;
  screen = 'library';
  render();
});

$('#fileInput')?.addEventListener('change', e => handleFiles(e.target.files));
document.addEventListener('files-dropped', e => handleFiles(e.detail.files));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initReader();

(async () => {
  try {
    await openDB();
    books = await getAllBooks();
  } catch (err) {
    console.error('DB init failed', err);
    showToast('Storage error. Books may not be available.', 'error');
  }
  render();
})();
