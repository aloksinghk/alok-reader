/**
 * library.js — renders all library-side screens (Home, Collections,
 * Bookmarks, Highlights, Upload).
 *
 * This module has no knowledge of the reader. It only reads/writes
 * the book list and emits callbacks to the caller (app.js).
 */

import { escapeHtml, titleOf, $ } from './utils.js';

// ---------------------------------------------------------------------------
// Library screen
// ---------------------------------------------------------------------------

/**
 * @param {Object} opts
 * @param {Array}  opts.books
 * @param {string} opts.query          current search string
 * @param {Function} opts.onOpen       (bookId) => void
 * @param {Function} opts.onAddBooks   () => void
 */
export function renderLibrary({ books, query, onOpen, onAddBooks }) {
  const filtered = books.filter(b =>
    !query
    || titleOf(b).toLowerCase().includes(query.toLowerCase())
    || (b.author || '').toLowerCase().includes(query.toLowerCase())
  );

  const active = books.find(b => b.progress > 0) || books[0];

  $('#content').innerHTML = `
    <div class="hero">
      <div class="hero-text">
        <h1>Good reading starts here.</h1>
        <p>Your personal books, redesigned for comfortable reading.</p>
      </div>
      <div class="hero-stats">
        <div class="stat-num">${books.length}</div>
        <div class="stat-label">books</div>
      </div>
    </div>

    ${active ? `
    <div class="section-head"><h2>Continue Reading</h2></div>
    <div class="continue-card" data-open="${active.id}">
      <div class="cover">${escapeHtml(titleOf(active))}</div>
      <div class="continue-info">
        <h3>${escapeHtml(titleOf(active))}</h3>
        <div class="muted">${escapeHtml(active.author || 'Personal book')}</div>
        <div class="continue-progress progress">
          <i style="width:${Math.max(1, Math.round((active.progress || 0) * 100))}%"></i>
        </div>
        <div class="muted">
          ${Math.round((active.progress || 0) * 100)}% complete ·
          ${active.lastPage || 0} of ${active.totalPages || '—'} pages
        </div>
        <div style="margin-top:14px">
          <button class="btn primary">Continue reading →</button>
        </div>
      </div>
    </div>` : ''}

    <div class="section-head">
      <h2>Your Library</h2>
      <button id="add" class="btn primary">＋ Add PDF</button>
    </div>

    ${filtered.length
      ? `<div class="book-grid">
          ${filtered.map(b => `
            <article class="book-card" data-open="${b.id}">
              <div class="book-cover">${escapeHtml(titleOf(b))}</div>
              <div class="book-title">${escapeHtml(titleOf(b))}</div>
              <div class="book-meta">
                <span>${escapeHtml(b.author || 'Personal book')}</span>
                <span>${Math.round((b.progress || 0) * 100)}%</span>
              </div>
              <div class="progress book-progress">
                <i style="width:${Math.max(0, Math.round((b.progress || 0) * 100))}%"></i>
              </div>
            </article>`).join('')}
         </div>`
      : `<div class="empty">
           <h3>Your library is empty</h3>
           <p>Add a PDF. Alok Reader will extract the text and turn it into a reflowable reading experience.</p>
           <button id="emptyAdd" class="btn primary">Add your first book</button>
         </div>`}
  `;

  $('#add')?.addEventListener('click', onAddBooks);
  $('#emptyAdd')?.addEventListener('click', onAddBooks);
  document.querySelectorAll('[data-open]').forEach(el =>
    el.addEventListener('click', () => onOpen(el.dataset.open))
  );
}

// ---------------------------------------------------------------------------
// Collections screen
// ---------------------------------------------------------------------------

export function renderCollections({ books }) {
  const names = ['All Books', 'Business', 'Finance', 'Self Help', 'Technology', 'Biography', 'Fiction'];
  $('#content').innerHTML = `
    <div class="section-head"><h2>Collections</h2></div>
    <div class="cards">
      ${names.map((n, i) => `
        <div class="info-card">
          <h3>${n}</h3>
          <p class="muted">${i === 0 ? books.length : 0} books</p>
        </div>`).join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// Bookmarks screen
// ---------------------------------------------------------------------------

export function renderBookmarks({ books, onOpen }) {
  const rows = books.flatMap(b => (b.bookmarks || []).map(p => ({ b, p })));

  let html = '<div class="section-head"><h2>Bookmarks</h2></div>';
  if (rows.length) {
    html += '<div class="list">';
    html += rows.map(x => `
      <div class="list-row">
        <span>🔖</span>
        <div class="grow">
          <strong>${escapeHtml(titleOf(x.b))}</strong>
          <div class="muted">${escapeHtml(x.p.label || `Page ${Number(x.p.page) + 1}`)}</div>
        </div>
        <button class="btn" data-open="${x.b.id}" data-page="${Number(x.p.page) || 0}">Open</button>
      </div>`).join('');
    html += '</div>';
  } else {
    html += '<div class="empty">No bookmarks yet.</div>';
  }

  $('#content').innerHTML = html;
  document.querySelectorAll('[data-open]').forEach(el =>
    el.addEventListener('click', () => onOpen(el.dataset.open, Number(el.dataset.page || 0)))
  );
}

// ---------------------------------------------------------------------------
// Highlights screen
// ---------------------------------------------------------------------------

export function renderHighlights({ books, onOpen }) {
  const rows = books.flatMap(b => (b.highlights || []).map(h => ({ b, h })));
  const colorHex = { yellow:'#fef08a', green:'#bbf7d0', blue:'#bae6fd', pink:'#fbcfe8', orange:'#fed7aa' };

  let html = '<div class="section-head"><h2>Highlights &amp; Notes</h2></div>';
  if (rows.length) {
    html += '<div class="list">';
    html += rows.map(x => {
      const dot = x.h.color
        ? `<span class="highlight-color-dot" style="background:${colorHex[x.h.color] || '#fef08a'}"></span>`
        : '';
      return `
        <div class="list-row highlight-row" data-open="${x.b.id}" data-page="${Number(x.h.page) || 0}">
          <span style="font-size:18px">🖊</span>
          <div class="grow">
            <strong>${escapeHtml(titleOf(x.b))}</strong>
            <div class="highlight-quote">${dot}${escapeHtml(x.h.text)}</div>
            ${x.h.note ? `<div class="highlight-note">📝 ${escapeHtml(x.h.note)}</div>` : ''}
            <div class="muted" style="margin-top:4px">Page ${Number(x.h.page || 0) + 1}</div>
          </div>
          <button class="btn" data-open="${x.b.id}" data-page="${Number(x.h.page) || 0}">Open</button>
        </div>`;
    }).join('');
    html += '</div>';
  } else {
    html += '<div class="empty"><h3>No highlights yet</h3><p>Select text while reading, pick a colour, and tap Highlight.</p></div>';
  }

  $('#content').innerHTML = html;
  document.querySelectorAll('[data-open]').forEach(el =>
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      onOpen(el.dataset.open, Number(el.dataset.page || 0));
    })
  );
  document.querySelectorAll('.highlight-row').forEach(el =>
    el.addEventListener('click', () => onOpen(el.dataset.open, Number(el.dataset.page || 0)))
  );
}

// ---------------------------------------------------------------------------
// Upload screen
// ---------------------------------------------------------------------------

export function renderUpload({ onAddBooks, onExportBackup, onImportBackup, onExportHighlights }) {
  $('#content').innerHTML = `
    <div class="section-head"><h2>Add Books</h2></div>
    <div class="upload-zone" id="drop">
      <div class="upload-icon">📄</div>
      <h2>Drop a PDF to start reading</h2>
      <p>Alok Reader extracts text from text-based PDFs and turns it into a clean, reflowable reading experience. The original PDF is kept as fallback.</p>
      <button id="choose" class="btn primary">Choose PDF files</button>
    </div>

    <div class="backup-section">
      <h3>📦 Backup &amp; Restore</h3>
      <p>Export your entire library — books, highlights, bookmarks and reading progress — as a JSON file you can restore on any device. The original PDF binaries are not included (re-import the PDFs after restoring).</p>
      <div class="backup-actions">
        <button id="exportBackup" class="btn primary">⬇ Export backup</button>
        <label class="btn" id="importBackupLabel" style="cursor:pointer">
          ⬆ Import backup
          <input type="file" id="importBackupInput" accept=".json" hidden>
        </label>
        <button id="exportHighlights" class="btn">📝 Export highlights (.md)</button>
      </div>
    </div>`;

  $('#choose').onclick = onAddBooks;
  $('#exportBackup')?.addEventListener('click', onExportBackup);
  $('#exportHighlights')?.addEventListener('click', onExportHighlights);
  $('#importBackupInput')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) onImportBackup(f);
    e.target.value = '';
  });

  const drop = $('#drop');
  ['dragenter','dragover'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); })
  );
  ['dragleave','drop'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); })
  );
  drop.addEventListener('drop', e => {
    drop.dispatchEvent(new CustomEvent('files-dropped', {
      bubbles: true, detail: { files: e.dataTransfer.files },
    }));
  });
}
