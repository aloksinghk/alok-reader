/**
 * backup.js — Export and import the full library as a portable backup.
 *
 * Export format (single .json file):
 * {
 *   version: 3,
 *   exportedAt: ISO string,
 *   books: [
 *     {
 *       id, name, title, author, created, progress, readerPage,
 *       totalPages, outline, bookmarks, highlights,
 *       md: "<full book text as markdown>",
 *       html: "<rendered HTML>"
 *     },
 *     ...
 *   ]
 * }
 *
 * The raw PDF binary (book.data ArrayBuffer) is intentionally excluded —
 * it would make the backup file enormous. The .md / .html content is
 * sufficient to restore the reading experience, highlights and bookmarks.
 *
 * Import merges by book id — existing books are updated, new ones are added.
 * The raw PDF binary is preserved if it already exists in the DB.
 */

import { getAllBooks, putBook } from './db.js';
import { showToast }           from './utils.js';

// ---------------------------------------------------------------------------
// HTML → Markdown (simple, good enough for books)
// ---------------------------------------------------------------------------
function htmlToMd(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const lines = [];
  for (const node of div.children) {
    const text = node.textContent.trim();
    if (!text) continue;
    if (node.tagName === 'H1') lines.push(`# ${text}\n`);
    else if (node.tagName === 'H2') lines.push(`## ${text}\n`);
    else if (node.tagName === 'H3') lines.push(`### ${text}\n`);
    else lines.push(text);
  }
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export async function exportBackup() {
  const books = await getAllBooks();
  if (!books.length) {
    showToast('No books to export.', 'info');
    return;
  }

  const payload = {
    version:    3,
    exportedAt: new Date().toISOString(),
    appName:    'Alok Reader',
    books: books.map(b => ({
      id:         b.id,
      name:       b.name,
      title:      b.title || b.name,
      author:     b.author || '',
      created:    b.created || Date.now(),
      progress:   b.progress || 0,
      readerPage: b.readerPage || 0,
      totalPages: b.totalPages || 0,
      outline:    b.outline || [],
      bookmarks:  b.bookmarks || [],
      highlights: b.highlights || [],
      md:         htmlToMd(b.html || ''),
      html:       b.html || '',
      // data (PDF binary) is excluded intentionally
    })),
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `alok-reader-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showToast(`Exported ${books.length} book${books.length > 1 ? 's' : ''} to backup file.`, 'success');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export async function importBackup(file) {
  if (!file) return;
  let payload;
  try {
    const text = await file.text();
    payload    = JSON.parse(text);
  } catch {
    showToast('Invalid backup file — could not parse JSON.', 'error');
    return;
  }

  if (!payload?.books || !Array.isArray(payload.books)) {
    showToast('Invalid backup file — missing books array.', 'error');
    return;
  }

  if (payload.version !== 3) {
    showToast(`Backup version ${payload.version} may not be fully compatible.`, 'info');
  }

  // Merge: keep existing PDF binary if available
  const existing = await getAllBooks();
  const byId     = Object.fromEntries(existing.map(b => [b.id, b]));

  let added = 0, updated = 0;
  for (const b of payload.books) {
    if (!b.id || !b.title) continue;
    const prev = byId[b.id];
    const merged = {
      ...prev,       // keep any local fields (including .data binary)
      ...b,          // overwrite with backup data
      data: prev?.data || null,  // never clobber existing PDF binary
    };
    await putBook(merged);
    prev ? updated++ : added++;
  }

  showToast(`Restored: ${added} new, ${updated} updated.`, 'success');
  return { added, updated };
}

// ---------------------------------------------------------------------------
// Export a single book as a standalone .md file
// ---------------------------------------------------------------------------
export function exportBookAsMarkdown(book) {
  const title  = book.title || book.name;
  const author = book.author ? `*${book.author}*\n\n` : '';
  const md     = `# ${title}\n\n${author}---\n\n${htmlToMd(book.html || '')}`;
  const blob   = new Blob([md], { type: 'text/markdown' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `${title.replace(/[^\w\s-]/g, '').trim()}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported "${title}" as Markdown.`, 'success');
}

// ---------------------------------------------------------------------------
// Export highlights from all books as a single .md file
// ---------------------------------------------------------------------------
export async function exportHighlightsAsMarkdown() {
  const books = await getAllBooks();
  const lines = ['# Alok Reader — Highlights & Notes', '', `*Exported ${new Date().toLocaleDateString()}*`, ''];

  for (const b of books) {
    const hl = b.highlights || [];
    if (!hl.length) continue;
    lines.push(`## ${b.title || b.name}`);
    if (b.author) lines.push(`*${b.author}*`);
    lines.push('');
    for (const h of hl) {
      lines.push(`> ${h.text}`);
      if (h.note) lines.push(`> 📝 ${h.note}`);
      lines.push(`> — Page ${Number(h.page) + 1}  `);
      lines.push('');
    }
  }

  const md   = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `alok-reader-highlights-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Highlights exported as Markdown.', 'success');
}
