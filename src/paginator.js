/**
 * paginator.js — deterministic reflowable page builder
 *
 * Improvements over v2.12:
 *  - Pure module with no global state; caller passes a state object.
 *  - Chapter list is built from the PDF outline when available,
 *    falling back to heading detection in the reflowed pages.
 *  - Stable paragraph IDs (data-pid) are preserved through splitting.
 */

import { escapeHtml } from './utils.js';

// ---------------------------------------------------------------------------
// Page metrics
// ---------------------------------------------------------------------------

/**
 * Compute the usable content dimensions for one physical page.
 * @param {HTMLElement} shell   .reading-shell element
 * @param {Object}      book    current book record
 * @returns {{ width, height, padX, padY, contentWidth, contentHeight }}
 */
export function pageMetrics(shell, book) {
  const spread = isEffectiveSpread(book);
  const width  = Math.max(320, spread ? Math.floor(shell.clientWidth / 2) : shell.clientWidth);
  const height = Math.max(300, shell.clientHeight - 18);
  const padX   = spread ? 42 : 52;
  const padY   = 34;
  return {
    width,
    height,
    padX,
    padY,
    contentWidth:  Math.min(book.textWidth || 760, width - padX * 2),
    contentHeight: height - padY * 2,
  };
}

export function isEffectiveSpread(book) {
  return book?.layout === 'spread' && window.innerWidth > 700;
}

// ---------------------------------------------------------------------------
// Off-screen measurement element
// ---------------------------------------------------------------------------

function createMeasureEl(book) {
  const m = document.createElement('div');
  const shell = document.querySelector('.reading-shell');
  const x = pageMetrics(shell, book);
  m.className = 'book-page measure-page';
  Object.assign(m.style, {
    position:      'fixed',
    left:          '-100000px',
    top:           '0',
    visibility:    'hidden',
    pointerEvents: 'none',
    boxSizing:     'border-box',
    overflow:      'hidden',
    width:         x.width + 'px',
    height:        x.height + 'px',
    padding:       x.padY + 'px ' + x.padX + 'px',
    fontSize:      (book.fontSize || 19) + 'px',
    lineHeight:    String(book.lineHeight || 1.6),
    fontFamily:    fontFamily(book),
  });
  document.body.appendChild(m);
  return m;
}

function fontFamily(book) {
  if (book.font === 'sans')  return 'Inter,Arial,sans-serif';
  if (book.font === 'book')  return '"Palatino Linotype",Palatino,Georgia,serif';
  return 'Georgia,"Times New Roman",serif';
}

function fits(measure, html) {
  measure.innerHTML = html;
  return measure.scrollHeight <= measure.clientHeight + 1;
}

// ---------------------------------------------------------------------------
// Paragraph splitting
// ---------------------------------------------------------------------------

/**
 * Split a paragraph node across multiple pages using binary search.
 * Preserves the data-pid of the original node on each chunk.
 */
function splitParagraph(node, measure, prefix) {
  const pid   = node.getAttribute('data-pid') || '';
  const words = node.textContent.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;
  let currentPrefix = prefix || '';

  while (i < words.length) {
    let lo = 1, hi = words.length - i, best = 0;
    while (lo <= hi) {
      const mid       = (lo + hi) >> 1;
      const candidate = currentPrefix
        + `<p data-pid="${pid}">${escapeHtml(words.slice(i, i + mid).join(' '))}</p>`;
      if (fits(measure, candidate)) { best = mid; lo = mid + 1; }
      else                          { hi   = mid - 1; }
    }
    if (best === 0) best = 1;
    chunks.push(
      currentPrefix
      + `<p data-pid="${pid}">${escapeHtml(words.slice(i, i + best).join(' '))}</p>`
    );
    i += best;
    currentPrefix = '';
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Main build function
// ---------------------------------------------------------------------------

/**
 * Build the array of physical reader pages from the book's raw HTML.
 *
 * @param {string} rawHtml          Full book HTML (from book.html or generated)
 * @param {Object} book             Book record (read-only, for typography settings)
 * @param {Array}  pdfOutline       Resolved PDF outline [{title, page, depth}]
 * @returns {{ pages: string[], chapters: Array<{title,page}> }}
 */
export function buildReaderPages(rawHtml, book, pdfOutline = []) {
  const source = document.createElement('div');
  source.innerHTML = rawHtml || '';
  const nodes   = [...source.children].filter(n => n.textContent.trim());
  const measure = createMeasureEl(book);

  const pages    = [];
  const chapters = [];   // {title, page} — page is 0-based physical index
  let pageHtml   = '';

  const commit = () => {
    if (pageHtml.trim()) pages.push(pageHtml);
    pageHtml = '';
  };

  for (const node of nodes) {
    const html      = node.outerHTML;
    const isHeading = node.tagName === 'H2' || node.tagName === 'H3';

    // Try to keep a heading on the same page as the content that follows it
    if (isHeading && pageHtml.trim()) {
      if (!fits(measure, pageHtml + html)) commit();
    }

    if (isHeading) {
      const title = node.textContent.trim();
      const pg    = pages.length;
      // Only record if not already in the list (avoids duplicate PDF text)
      if (!chapters.some(c => c.title.toLowerCase() === title.toLowerCase())) {
        chapters.push({ title, page: pg });
      }
    }

    if (fits(measure, pageHtml + html)) {
      pageHtml += html;
      continue;
    }

    if (pageHtml.trim()) commit();

    if (node.tagName === 'P') {
      const chunks = splitParagraph(node, measure, '');
      chunks.forEach((chunk, i) => {
        pageHtml = chunk;
        if (i < chunks.length - 1) commit();
      });
    } else {
      pageHtml = html;
      commit();
    }
  }

  commit();
  measure.remove();

  if (!pages.length) {
    pages.push('<p>No readable text was extracted from this book.</p>');
  }

  // Remap chapter pages after final pagination
  const remappedChapters = chapters.map(ch => {
    const needle = ch.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re     = new RegExp(needle);
    const found  = pages.findIndex(p => re.test(p));
    return { ...ch, page: found >= 0 ? found : ch.page };
  });

  // If the PDF provided a real outline, prefer it for chapter titles/order.
  // We merge: outline entries that have a matching page marker take priority.
  let finalChapters = remappedChapters;
  if (pdfOutline.length) {
    // Use outline as the authoritative list; annotate with physical reader page
    // by matching the heading text in the rendered pages.
    const outlined = pdfOutline.map(entry => {
      const needle = entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re     = new RegExp(needle, 'i');
      const found  = pages.findIndex(p => re.test(p));
      return { title: entry.title, page: found >= 0 ? found : 0, depth: entry.depth };
    }).filter((e, i, arr) =>
      // Remove entries where we couldn't locate the heading and there's no
      // useful page info (avoids TOC showing everything at page 0).
      e.page > 0 || i === 0
    );
    if (outlined.length > 0) finalChapters = outlined;
  }

  return { pages, chapters: finalChapters };
}
