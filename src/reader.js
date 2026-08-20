/**
 * reader.js — Reader UI: rendering, navigation, settings, search, TOC,
 * bookmarks, selection tools, keyboard/touch handling.
 *
 * Improvements over v2.15.2:
 *  - Event listeners on layout/width/font/theme/line buttons are registered
 *    ONCE at boot, not re-registered on every settings open (fixes duplicate
 *    listener bug).
 *  - Uses module-level highlight functions from highlights.js (stable pid path).
 *  - Keyboard shortcut overlay added (press ? to open).
 *  - Error boundaries around openBook and repaginate.
 *  - Uses real PDF outline for TOC via paginator.js.
 */

import { buildReaderPages }    from './paginator.js';
import {
  applyStoredHighlights,
  removeHighlightMarks,
  getActiveSelection,
  createHighlightRecord,
  HIGHLIGHT_COLORS,
} from './highlights.js';
import { showDictionary, closeDictionary, isSingleWord } from './dictionary.js';
import { putBook }             from './db.js';
import { escapeHtml, titleOf, $, showToast } from './utils.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let current           = null;  // active book record
let readerPages       = [];
let readerPhysicalPage= 0;
let readerChapters    = [];
let readerBookmarks   = [];
let readerHighlights  = [];
let rawReadingHtml    = '';
let activeSelection   = null;
let selectedColor     = 'yellow';   // current highlight colour
let onCloseReader     = null;
let settingsListenersReady = false;

// ---------------------------------------------------------------------------
// Getters (used by app.js)
// ---------------------------------------------------------------------------

export function getCurrent()    { return current; }
export function getPageIndex()  { return readerPhysicalPage; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fontFamily(book) {
  if (book?.font === 'sans')  return 'Inter,Arial,sans-serif';
  if (book?.font === 'book')  return '"Palatino Linotype",Palatino,Georgia,serif';
  return 'Georgia,"Times New Roman",serif';
}

function isEffectiveSpread() {
  return current?.layout === 'spread' && window.innerWidth > 700;
}

function getUnitCount() {
  return isEffectiveSpread()
    ? Math.max(1, Math.ceil(readerPages.length / 2))
    : Math.max(1, readerPages.length);
}

function getUnitIndex() {
  return isEffectiveSpread()
    ? Math.floor(readerPhysicalPage / 2)
    : readerPhysicalPage;
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

export function renderReaderPage() {
  const text = $('#readingText');
  if (!text || !current) return;

  const spread = isEffectiveSpread();
  const shell  = $('.reading-shell');
  if (shell) shell.classList.toggle('spread-reading', spread);

  const first = spread
    ? Math.min(readerPages.length - 1, Math.floor(readerPhysicalPage / 2) * 2)
    : readerPhysicalPage;

  let html = `<section class="book-page">${readerPages[first] || ''}</section>`;
  if (spread && readerPages[first + 1]) {
    html += `<section class="book-page">${readerPages[first + 1]}</section>`;
  }

  text.className = 'reading-text ' + (current.font || 'serif') + (spread ? ' spread-mode' : '');
  text.innerHTML  = html;
  text.style.fontSize   = (current.fontSize || 19) + 'px';
  text.style.lineHeight = String(current.lineHeight || 1.6);

  updatePageLabel();
  updateBookmarkButton();
  requestAnimationFrame(() => applyStoredHighlights(readerHighlights, readerPhysicalPage));
}

function updatePageLabel() {
  const units = getUnitCount();
  const idx   = Math.min(units - 1, Math.max(0, getUnitIndex()));
  const pct   = units <= 1 ? 0 : Math.round(idx / (units - 1) * 100);

  const progress = $('#readerProgress');
  if (progress) progress.value = pct;

  const label = $('#readerProgressLabel');
  if (label) {
    const totalWords    = (rawReadingHtml || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    const wpm           = 220;
    const remaining     = Math.max(0, Math.round(totalWords * (1 - pct / 100) / wpm));
    const timeText      = remaining >= 60 ? `${Math.floor(remaining / 60)}h ${remaining % 60}m` : `${remaining}m`;
    if (isEffectiveSpread()) {
      const first = idx * 2 + 1;
      const last  = Math.min(readerPages.length, first + 1);
      label.textContent = `Pages ${first}–${last} / ${readerPages.length} · ${pct}% · ${timeText} left`;
    } else {
      label.textContent = `Page ${idx + 1} / ${readerPages.length} · ${pct}% · ${timeText} left`;
    }
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export async function goToPhysicalPage(physical, save = true) {
  const target = Math.max(0, Math.min(readerPages.length - 1, physical));
  readerPhysicalPage = isEffectiveSpread() ? Math.floor(target / 2) * 2 : target;
  renderReaderPage();
  if (save) await saveProgress();
}

export async function goToPage(unitIndex, save = true) {
  const units    = getUnitCount();
  const target   = Math.max(0, Math.min(units - 1, unitIndex));
  const physical = isEffectiveSpread() ? target * 2 : target;
  await goToPhysicalPage(physical, save);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function repaginate() {
  if (!current) return;
  try {
    const oldPhysical  = readerPhysicalPage;
    const result       = buildReaderPages(rawReadingHtml, current, current.outline || []);
    readerPages        = result.pages;
    readerChapters     = result.chapters;
    readerPhysicalPage = Math.min(oldPhysical, readerPages.length - 1);
    renderReaderPage();
    renderChapterList();
  } catch (err) {
    console.error('Pagination error', err);
    showToast('Could not paginate this book. Try adjusting font size.', 'error');
  }
}

function restorePosition() {
  try {
    const result       = buildReaderPages(rawReadingHtml, current, current.outline || []);
    readerPages        = result.pages;
    readerChapters     = result.chapters;

    const savedPhysical = current.readerPage != null
      ? Number(current.readerPage)
      : Math.round((current.progress || 0) * Math.max(0, readerPages.length - 1));

    readerPhysicalPage = Math.max(0, Math.min(readerPages.length - 1, savedPhysical));
    renderReaderPage();
  } catch (err) {
    console.error('Restore position error', err);
    readerPages        = ['<p>Could not paginate this book.</p>'];
    readerPhysicalPage = 0;
    renderReaderPage();
  }
}

async function saveProgress() {
  if (!current || !readerPages.length) return;
  current.readerPage = readerPhysicalPage;
  current.progress   = readerPages.length <= 1 ? 0
    : readerPhysicalPage / Math.max(1, readerPages.length - 1);
  await putBook(current);
}

// ---------------------------------------------------------------------------
// Open a book
// ---------------------------------------------------------------------------

/**
 * Open a book record in the reader.
 * @param {Object}   book         Full book record from DB
 * @param {number}   startPage    Optional physical page to jump to
 * @param {Function} onClose      Called when reader is closed
 */
export async function openBook(book, startPage = null, onClose = null) {
  current       = book;
  onCloseReader = onClose;

  loadHighlights();
  loadBookmarks();

  $('#readerBookTitle').textContent = titleOf(current);
  rawReadingHtml = `
    <div class="book-front">
      <div class="chapter-kicker">Reading</div>
      <h1>${escapeHtml(titleOf(current))}</h1>
      <div class="reading-author">${escapeHtml(current.author || 'Personal book')}</div>
    </div>
    ${current.html || ''}`;

  const reader = $('#reader');
  reader.className = 'reader ' + (current.theme || 'light');
  reader.classList.remove('hidden');

  $('#readerContents')?.classList.add('hidden');
  $('#readerBookmarks')?.classList.add('hidden');

  updateSettingsUI();

  if (startPage != null) {
    const result       = buildReaderPages(rawReadingHtml, current, current.outline || []);
    readerPages        = result.pages;
    readerChapters     = result.chapters;
    readerPhysicalPage = Math.max(0, Math.min(readerPages.length - 1, startPage));
    renderReaderPage();
  } else {
    restorePosition();
  }

  renderChapterList();
  renderReaderBookmarks();
}

// ---------------------------------------------------------------------------
// Settings UI — listeners registered ONCE
// ---------------------------------------------------------------------------

function updateSettingsUI() {
  if (!current) return;
  $('#fontSizeValue').textContent = (current.fontSize || 19) + 'px';
  document.querySelectorAll('#fontChoices button').forEach(b =>
    b.classList.toggle('active', b.dataset.font === (current.font || 'serif'))
  );
  document.querySelectorAll('#themeChoices button').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === (current.theme || 'light'))
  );
  document.querySelectorAll('#lineChoices button').forEach(b =>
    b.classList.toggle('active', String(b.dataset.line) === String(current.lineHeight || 1.6))
  );
  document.querySelectorAll('#layoutChoices button').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === (current.layout || 'single'))
  );
  document.querySelectorAll('#widthChoices button').forEach(b =>
    b.classList.toggle('active', String(b.dataset.width) === String(current.textWidth || 760))
  );
}

/**
 * Wire all settings button listeners exactly once.
 * Called from initReader() at boot.
 */
function initSettingsListeners() {
  if (settingsListenersReady) return;
  settingsListenersReady = true;

  // Font family
  document.querySelectorAll('#fontChoices button').forEach(b => b.addEventListener('click', async () => {
    if (!current) return;
    current.font = b.dataset.font;
    updateSettingsUI();
    repaginate();
    await putBook(current);
  }));

  // Theme
  document.querySelectorAll('#themeChoices button').forEach(b => b.addEventListener('click', async () => {
    if (!current) return;
    current.theme = b.dataset.theme;
    $('#reader').className = 'reader ' + current.theme;
    updateSettingsUI();
    await putBook(current);
  }));

  // Line spacing
  document.querySelectorAll('#lineChoices button').forEach(b => b.addEventListener('click', async () => {
    if (!current) return;
    current.lineHeight = +b.dataset.line;
    updateSettingsUI();
    repaginate();
    await putBook(current);
  }));

  // Layout (single / spread)
  document.querySelectorAll('#layoutChoices button').forEach(b => b.addEventListener('click', async () => {
    if (!current) return;
    const physical = readerPhysicalPage;
    current.layout = b.dataset.layout;
    const result       = buildReaderPages(rawReadingHtml, current, current.outline || []);
    readerPages        = result.pages;
    readerChapters     = result.chapters;
    readerPhysicalPage = Math.max(0, Math.min(readerPages.length - 1,
      current.layout === 'spread' ? Math.floor(physical / 2) * 2 : physical));
    updateSettingsUI();
    renderReaderPage();
    renderChapterList();
    await putBook(current);
  }));

  // Text width
  document.querySelectorAll('#widthChoices button').forEach(b => b.addEventListener('click', async () => {
    if (!current) return;
    current.textWidth = +b.dataset.width;
    updateSettingsUI();
    repaginate();
    await putBook(current);
  }));

  // Font size
  $('#fontDown')?.addEventListener('click', async () => {
    if (!current) return;
    current.fontSize = Math.max(14, (current.fontSize || 19) - 1);
    updateSettingsUI();
    repaginate();
    await putBook(current);
  });
  $('#fontUp')?.addEventListener('click', async () => {
    if (!current) return;
    current.fontSize = Math.min(30, (current.fontSize || 19) + 1);
    updateSettingsUI();
    repaginate();
    await putBook(current);
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function initSearch() {
  $('#readerSearchInput').oninput = e => {
    const q = e.target.value.trim();
    if (!q) {
      rawReadingHtml = `
        <div class="book-front">
          <div class="chapter-kicker">Reading</div>
          <h1>${escapeHtml(titleOf(current))}</h1>
          <div class="reading-author">${escapeHtml(current.author || 'Personal book')}</div>
        </div>
        ${current.html || ''}`;
      repaginate();
      $('#readerSearchCount').textContent = '';
      return;
    }
    const temp    = document.createElement('div');
    temp.innerHTML = current.html || '';
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re      = new RegExp(escaped, 'ig');
    let n = 0;
    temp.querySelectorAll('p,h2,h3').forEach(el => {
      const plain = el.textContent;
      n += (plain.match(re) || []).length;
      el.innerHTML = escapeHtml(plain).replace(re, m => `<mark class="search-hit">${m}</mark>`);
    });
    rawReadingHtml = temp.innerHTML;
    repaginate();
    $('#readerSearchCount').textContent = n ? `${n} matches` : 'No matches';
  };
}

// ---------------------------------------------------------------------------
// Table of Contents
// ---------------------------------------------------------------------------

function renderChapterList() {
  const panel = $('#readerContents');
  if (!panel) return;
  if (!readerChapters.length) {
    panel.innerHTML = '<div class="contents-empty">No chapters detected in this book.</div>';
    return;
  }
  panel.innerHTML = `
    <div class="contents-title">Contents</div>
    <div class="contents-book">${escapeHtml(titleOf(current))}</div>
    <div class="contents-list">
      ${readerChapters.map((c, i) => `
        <button class="contents-item" data-chapter="${i}">
          <span>${escapeHtml(c.title)}</span>
          <small>${c.page + 1}</small>
        </button>`).join('')}
    </div>`;
  panel.querySelectorAll('[data-chapter]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ch = readerChapters[Number(btn.dataset.chapter)];
      if (!ch) return;
      await goToPhysicalPage(ch.page);
      panel.classList.add('hidden');
    });
  });
}

function toggleContents() {
  const panel = $('#readerContents');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderChapterList();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

function loadBookmarks() {
  readerBookmarks = Array.isArray(current?.bookmarks) ? current.bookmarks : [];
}

function isBookmarked(page = readerPhysicalPage) {
  return readerBookmarks.some(b => Number(b.page) === Number(page));
}

function updateBookmarkButton() {
  const b = $('#readerBookmarkBtn');
  if (!b) return;
  const active = isBookmarked();
  b.classList.toggle('active', active);
  b.textContent = active ? '★' : '☆';
  b.title       = active ? 'Remove bookmark' : 'Bookmark this page';
}

async function toggleBookmark() {
  if (!current) return;
  loadBookmarks();
  const page = readerPhysicalPage;
  const idx  = readerBookmarks.findIndex(b => Number(b.page) === Number(page));
  if (idx >= 0) {
    readerBookmarks.splice(idx, 1);
  } else {
    readerBookmarks.push({
      page,
      createdAt: new Date().toISOString(),
      label: isEffectiveSpread()
        ? `Pages ${page + 1}–${Math.min(readerPages.length, page + 2)}`
        : `Page ${page + 1}`,
    });
    readerBookmarks.sort((x, y) => x.page - y.page);
  }
  current.bookmarks = readerBookmarks;
  await putBook(current);
  updateBookmarkButton();
  renderReaderBookmarks();
}

function renderReaderBookmarks() {
  const panel = $('#readerBookmarks');
  if (!panel) return;
  loadBookmarks();
  if (!readerBookmarks.length) {
    panel.innerHTML = '<div class="contents-empty">No bookmarks yet. Click ☆ while reading.</div>';
    return;
  }
  panel.innerHTML = `
    <div class="contents-title">Bookmarks</div>
    <div class="contents-book">${escapeHtml(titleOf(current))}</div>
    <div class="contents-list">
      ${readerBookmarks.map((b, i) => `
        <button class="contents-item" data-bookmark="${i}">
          <span>${escapeHtml(b.label || `Page ${Number(b.page) + 1}`)}</span>
          <small>→</small>
        </button>`).join('')}
    </div>`;
  panel.querySelectorAll('[data-bookmark]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const b = readerBookmarks[Number(btn.dataset.bookmark)];
      if (!b) return;
      await goToPhysicalPage(Number(b.page));
      panel.classList.add('hidden');
    });
  });
}

function toggleBookmarks() {
  const panel = $('#readerBookmarks');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    renderReaderBookmarks();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

function loadHighlights() {
  readerHighlights = Array.isArray(current?.highlights) ? current.highlights : [];
}

function closeSelectionMenu() {
  $('#selectionMenu')?.classList.add('hidden');
}

function clearActiveSelection() {
  activeSelection = null;
}

function openSelectionMenu() {
  const picked = getActiveSelection();
  const menu   = $('#selectionMenu');
  if (!picked || !menu) return;
  activeSelection = picked;

  // Build colour swatches row
  const swatches = HIGHLIGHT_COLORS.map(c => `
    <button class="color-swatch swatch-${c.id} ${c.id === selectedColor ? 'active' : ''}"
      data-color="${c.id}" title="${c.label}" aria-label="Highlight ${c.label}"></button>
  `).join('');

  // Dictionary button only for single words
  const word       = picked.text.trim();
  const singleWord = isSingleWord(word);
  const dictBtn    = singleWord
    ? `<button class="selection-action" id="selectionDict" role="menuitem">📖 Define</button>`
    : '';

  // Rebuild menu HTML
  menu.innerHTML = `
    <div class="selection-menu-row" style="padding:4px 6px 2px">
      ${swatches}
    </div>
    <div class="selection-divider"></div>
    <div class="selection-menu-row">
      <button class="selection-action" id="selectionHighlight" role="menuitem">🖊 Highlight</button>
      <button class="selection-action" id="selectionNote"      role="menuitem">📝 Note</button>
      ${dictBtn}
    </div>`;

  // Position above the selection
  const rect = picked.range.getBoundingClientRect();
  const menuW = 230;
  let left = rect.left + rect.width / 2 - menuW / 2;
  left = Math.max(8, Math.min(window.innerWidth - menuW - 8, left));
  const top = Math.max(64, rect.top - 96);
  menu.style.left  = left + 'px';
  menu.style.top   = top  + 'px';
  menu.style.width = menuW + 'px';
  menu.classList.remove('hidden');

  // ── Swatch listeners ──
  menu.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectedColor = btn.dataset.color;
      menu.querySelectorAll('.color-swatch').forEach(s =>
        s.classList.toggle('active', s.dataset.color === selectedColor)
      );
    });
  });

  // ── Highlight button ──
  const hlBtn = menu.querySelector('#selectionHighlight');
  hlBtn?.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  hlBtn?.addEventListener('click',     e => { e.stopPropagation(); createHighlightFromSelection(); });

  // ── Note button ──
  const noteBtn = menu.querySelector('#selectionNote');
  noteBtn?.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  noteBtn?.addEventListener('click',     e => { e.stopPropagation(); createNoteFromSelection(); });

  // ── Dictionary button ──
  if (singleWord) {
    const dictEl = menu.querySelector('#selectionDict');
    dictEl?.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    dictEl?.addEventListener('click', e => {
      e.stopPropagation();
      const capturedWord = word;
      const capturedRect = picked.range.getBoundingClientRect();
      closeSelectionMenu();
      clearActiveSelection();
      showDictionary(capturedWord, capturedRect);
    });
  }
}

async function saveHighlightRecord(record) {
  loadHighlights();
  const dup = readerHighlights.find(h =>
    Number(h.page) === record.page && h.text === record.text
  );
  if (dup) {
    if (record.note) dup.note = record.note;
  } else {
    readerHighlights.push(record);
  }
  current.highlights = readerHighlights;
  await putBook(current);

  // Re-render the page so highlights apply to a clean DOM
  // (avoids double-wrapping if the mark is already in the DOM)
  renderReaderPage();
}

async function createHighlightFromSelection() {
  if (!activeSelection) return;
  const record = createHighlightRecord(activeSelection, readerPhysicalPage, '', selectedColor);
  closeSelectionMenu();
  clearActiveSelection();
  window.getSelection()?.removeAllRanges();
  await saveHighlightRecord(record);
}

async function createNoteFromSelection() {
  if (!activeSelection) return;
  const picked = activeSelection;
  closeSelectionMenu();
  clearActiveSelection();
  const note = window.prompt('Add a note for this highlight:', '');
  window.getSelection()?.removeAllRanges();
  if (note !== null) {
    const record = createHighlightRecord(picked, readerPhysicalPage, note.trim(), selectedColor);
    await saveHighlightRecord(record);
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts overlay
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { key: '← / PageUp',    desc: 'Previous page' },
  { key: '→ / PageDown',  desc: 'Next page' },
  { key: 'f',             desc: 'Search in book' },
  { key: 't',             desc: 'Table of contents' },
  { key: 'b',             desc: 'Toggle bookmark' },
  { key: 'Escape',        desc: 'Close reader / panels' },
  { key: '?',             desc: 'Show this shortcuts guide' },
];

function toggleShortcutsOverlay() {
  let overlay = document.getElementById('shortcutsOverlay');
  if (overlay) { overlay.remove(); return; }

  overlay = document.createElement('div');
  overlay.id = 'shortcutsOverlay';
  overlay.className = 'shortcuts-overlay';
  overlay.innerHTML = `
    <div class="shortcuts-box">
      <div class="shortcuts-header">
        <strong>Keyboard shortcuts</strong>
        <button class="shortcuts-close" id="shortcutsClose">×</button>
      </div>
      <table class="shortcuts-table">
        ${SHORTCUTS.map(s => `
          <tr>
            <td><kbd>${escapeHtml(s.key)}</kbd></td>
            <td>${escapeHtml(s.desc)}</td>
          </tr>`).join('')}
      </table>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('shortcutsClose').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ---------------------------------------------------------------------------
// Touch swipe
// ---------------------------------------------------------------------------

function initTouchSwipe() {
  const shell = $('.reading-shell');
  if (!shell) return;
  let startX = 0, startY = 0;
  shell.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  shell.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goToPage(getUnitIndex() + 1);
      else         goToPage(getUnitIndex() - 1);
    }
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Public init — call once at app startup
// ---------------------------------------------------------------------------

export function initReader(opts = {}) {
  onCloseReader = opts.onClose || null;

  // Settings listeners — registered exactly once
  initSettingsListeners();

  // Search
  initSearch();

  // Touch swipe
  initTouchSwipe();

  // --- Static button wiring ---
  $('#readerClose').onclick = async () => {
    $('#reader').classList.add('hidden');
    closeDictionary();
    current = null;
    if (onCloseReader) await onCloseReader();
  };

  $('#pdfClose').onclick = () => {
    $('#pdfViewer').classList.add('hidden');
    $('#pdfFrame').src = '';
  };

  $('#readerOriginal').onclick = () => {
    if (!current?.data) return;
    const blob = new Blob([current.data], { type: 'application/pdf' });
    $('#pdfFrame').src = URL.createObjectURL(blob);
    $('#pdfViewer').classList.remove('hidden');
  };

  $('#readerSearchBtn').onclick = () => {
    $('#readerSearch').classList.toggle('hidden');
    $('#readerSearchInput').focus();
  };

  $('#readerContentsBtn')?.addEventListener('click', toggleContents);
  $('#readerBookmarksBtn')?.addEventListener('click', toggleBookmarks);
  $('#readerBookmarkBtn')?.addEventListener('click', toggleBookmark);

  $('#readerAa')?.addEventListener('click',   () => $('#readingSettings')?.classList.toggle('hidden'));
  $('#settingsBtn')?.addEventListener('click', () => $('#readingSettings')?.classList.toggle('hidden'));
  $('#closeSettings')?.addEventListener('click', () => $('#readingSettings')?.classList.add('hidden'));

  // Progress scrubber
  $('#readerProgress')?.addEventListener('input', e => {
    const units = getUnitCount();
    goToPage(Math.round((+e.target.value / 100) * Math.max(0, units - 1)));
  });

  // Prev / Next buttons
  $('#prevReaderPage')?.addEventListener('click', () => goToPage(getUnitIndex() - 1));
  $('#nextReaderPage')?.addEventListener('click', () => goToPage(getUnitIndex() + 1));

  // Selection menu — built dynamically in openSelectionMenu().
  // IMPORTANT: mousedown fires before mouseup/click, so we must NOT clear
  // activeSelection when the user clicks inside the selection menu.
  // We only clear it when clicking genuinely outside both the menu and
  // the reading text (i.e. elsewhere on the page).
  document.addEventListener('mousedown', e => {
    const menu = $('#selectionMenu');
    if (menu && !menu.classList.contains('hidden') && menu.contains(e.target)) {
      // Click is inside the menu — let the button's click handler run
      return;
    }
    // Clicking inside the reading area may start a new selection — don't
    // close the menu yet; wait for mouseup to re-evaluate.
    const readingText = $('#readingText');
    if (readingText && readingText.contains(e.target)) {
      // Close the current menu (a new selection may be starting)
      closeSelectionMenu();
      // Keep activeSelection a bit longer in case the user just
      // clicked without moving — mouseup will clear if no new selection.
      return;
    }
    // Clicked outside everything — close menu and clear state
    closeSelectionMenu();
    clearActiveSelection();
    closeDictionary();
  });

  const reader = $('#readingText');
  if (reader) {
    reader.addEventListener('mouseup',  () => setTimeout(openSelectionMenu, 0));
    reader.addEventListener('touchend', () => setTimeout(openSelectionMenu, 80), { passive: true });
  }

  // Keyboard
  document.addEventListener('keydown', e => {
    if ($('#reader')?.classList.contains('hidden')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goToPage(getUnitIndex() + 1); }
    if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   { e.preventDefault(); goToPage(getUnitIndex() - 1); }
    if (e.key === 'Escape') {
      const shortcuts = document.getElementById('shortcutsOverlay');
      if (shortcuts) { shortcuts.remove(); return; }
      closeDictionary();
      $('#readerClose').click();
    }
    if (e.key === 'f') $('#readerSearchBtn').click();
    if (e.key === 't') toggleContents();
    if (e.key === 'b') toggleBookmark();
    if (e.key === '?') toggleShortcutsOverlay();
  });

  // Resize: re-render if spread state changed
  let lastNarrow = window.innerWidth <= 700;
  window.addEventListener('resize', () => {
    if ($('#reader')?.classList.contains('hidden') || !current) return;
    const nowNarrow = window.innerWidth <= 700;
    if (nowNarrow !== lastNarrow) {
      lastNarrow = nowNarrow;
      renderReaderPage();
      updatePageLabel();
    }
  });
}
