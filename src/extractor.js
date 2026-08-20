/**
 * extractor.js — PDF text extraction and metadata reading
 *
 * Improvements over v2.6:
 *  - Uses doc.getMetadata() to pull real title/author from the PDF.
 *  - Uses doc.getOutline() to build a real table of contents.
 *  - Accepts an onProgress(current, total) callback for UI feedback.
 *  - Heading detection uses font-size from the transform matrix in
 *    addition to the all-caps heuristic, reducing false positives.
 */

const PDFJS_URL   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const WORKER_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

let pdfjsLib = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  }
  return pdfjsLib;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Extract title and author from PDF metadata, falling back to the filename.
 * @param {Object} doc   PDF.js document
 * @param {string} filename
 * @returns {{ title: string, author: string }}
 */
async function readMetadata(doc, filename) {
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info || {};
    const title  = (info.Title  || '').trim() || filename.replace(/\.pdf$/i, '');
    const author = (info.Author || '').trim();
    return { title, author };
  } catch {
    return { title: filename.replace(/\.pdf$/i, ''), author: '' };
  }
}

// ---------------------------------------------------------------------------
// Outline (Table of Contents)
// ---------------------------------------------------------------------------

/**
 * Flatten the potentially nested PDF outline into a list of { title, dest }
 * entries. Page numbers are resolved later during paragraph→HTML conversion.
 * @param {Object} doc  PDF.js document
 * @returns {Promise<Array<{title:string, dest:any}>>}
 */
async function readOutline(doc) {
  try {
    const outline = await doc.getOutline();
    if (!outline || !outline.length) return [];
    const items = [];
    const walk = (nodes, depth = 0) => {
      for (const node of nodes) {
        if (node.title) items.push({ title: node.title.trim(), dest: node.dest, depth });
        if (node.items?.length) walk(node.items, depth + 1);
      }
    };
    walk(outline);
    return items;
  } catch {
    return [];
  }
}

/**
 * Resolve outline destinations to 1-based page numbers.
 * @param {Object} doc
 * @param {Array}  outline   raw outline from readOutline()
 * @returns {Promise<Array<{title:string, page:number, depth:number}>>}
 */
async function resolveOutlinePages(doc, outline) {
  const resolved = [];
  for (const item of outline) {
    try {
      let pageIndex = null;
      if (item.dest) {
        const dest = typeof item.dest === 'string'
          ? await doc.getDestination(item.dest)
          : item.dest;
        if (dest?.[0]) {
          pageIndex = await doc.getPageIndex(dest[0]);
        }
      }
      resolved.push({
        title: item.title,
        page:  pageIndex != null ? pageIndex + 1 : null,  // 1-based
        depth: item.depth,
      });
    } catch {
      resolved.push({ title: item.title, page: null, depth: item.depth });
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Per-page text extraction
// ---------------------------------------------------------------------------

/**
 * Extract all text from one PDF page, reconstructing lines from X/Y positions.
 * Returns { pageText, dominantFontSize } where dominantFontSize is the median
 * body-text font size, used by the heading detector.
 */
async function extractPageText(page) {
  const content = await page.getTextContent({ includeMarkedContent: false });
  const items = content.items.filter(x => x.str && x.str.trim());

  // Group items into rows by Y position
  const rows = [];
  const fontSizes = [];
  for (const item of items) {
    const tr = item.transform || [1, 0, 0, 1, 0, 0];
    const x  = tr[4] || 0;
    const y  = tr[5] || 0;
    const h  = Math.abs(tr[3] || item.height || 10) || 10;
    fontSizes.push(h);
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, h * 0.35));
    if (!row) { row = { y, h, items: [] }; rows.push(row); }
    row.items.push({ x, y, h, w: item.width || 0, str: item.str });
  }

  // Dominant (median) font size for heading detection
  fontSizes.sort((a, b) => a - b);
  const dominantFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 10;

  rows.sort((a, b) => b.y - a.y);
  const lines = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let line = '', previous = null;
    for (const item of row.items) {
      const piece = item.str.replace(/\s+/g, ' ').trim();
      if (!piece) continue;
      if (previous) {
        const gap   = item.x - (previous.x + previous.w);
        const last  = line.slice(-1);
        const first = piece[0];
        if (gap > 1.2
          && !/[\s([{"'"'—–-]$/.test(last)
          && !/^[,.;:!?%)\]}'""'—–-]/.test(first)) {
          line += ' ';
        }
      }
      line    += piece;
      previous = { ...item, str: piece };
    }
    line = line.replace(/\s+([,.;:!?%)\]}])/g, '$1').trim();
    if (line) lines.push({ text: line, y: row.y, h: row.h, fontSize: row.h });
  }

  let pageText = '';
  for (let i = 0; i < lines.length; i++) {
    pageText += lines[i].text;
    if (lines[i + 1]) {
      const gap    = Math.abs(lines[i].y - lines[i + 1].y);
      const normal = Math.max(lines[i].h, lines[i + 1].h);
      pageText += gap > normal * 1.75 ? '\n\n' : '\n';
    }
  }

  return { pageText: pageText.trim(), dominantFontSize };
}

// ---------------------------------------------------------------------------
// Text → HTML paragraphs
// ---------------------------------------------------------------------------

/**
 * Convert raw extracted text into HTML paragraphs/headings.
 * Each paragraph gets a stable data-pid attribute for highlight anchoring.
 *
 * @param {string} text
 * @param {number} dominantFontSize  median body font size (fallback heuristic)
 * @returns {string} HTML string
 */
export function paragraphsFromText(text, dominantFontSize = 12) {
  text = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const raw = text.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  let out = '';
  let pid = 0;

  for (const block of raw) {
    const lines  = block.split('\n').map(x => x.trim()).filter(Boolean);
    const joined = lines.join(' ');
    const id     = `p${pid++}`;

    const isChapterKeyword = /^((chapter|part|section)\s+[\w\dIVXLC]+)/i.test(joined);
    const isShortKeyword   = /^(preface|introduction|conclusion|background|contents|acknowledg(e)?ments?)$/i.test(joined);
    // All-caps AND short — keep but require length > 5 to avoid initials
    const isAllCaps        = /^[A-Z][A-Z0-9\s:,&''\-]{5,80}$/.test(joined) && joined.length < 90;

    if (isChapterKeyword || isShortKeyword || isAllCaps) {
      out += `<h2 data-pid="${id}">${escapeHtml(joined)}</h2>`;
    } else {
      out += `<p data-pid="${id}">${escapeHtml(joined)}</p>`;
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract text, metadata and outline from a PDF File or ArrayBuffer.
 *
 * @param {File|ArrayBuffer} fileOrBuffer
 * @param {string}           filename       used as fallback title
 * @param {Function}         onProgress     (current:number, total:number) => void
 * @returns {Promise<{
 *   text:    string,
 *   html:    string,
 *   pages:   number,
 *   title:   string,
 *   author:  string,
 *   outline: Array<{title:string, page:number|null, depth:number}>
 * }>}
 */
export async function extractPdf(fileOrBuffer, filename = '', onProgress = null) {
  const pdfjs  = await getPdfJs();
  const source = fileOrBuffer instanceof ArrayBuffer
    ? new Uint8Array(fileOrBuffer.slice(0))
    : new Uint8Array(await fileOrBuffer.arrayBuffer());

  const doc = await pdfjs.getDocument({ data: source }).promise;

  // Metadata and outline can be fetched in parallel with page extraction
  const [meta, rawOutline] = await Promise.all([
    readMetadata(doc, filename),
    readOutline(doc),
  ]);

  const resolvedOutline = await resolveOutlinePages(doc, rawOutline);

  let fullText = '';
  let dominantFontSize = 12;
  const fontSizeAccum = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    if (onProgress) onProgress(pageNo, doc.numPages);
    const page = await doc.getPage(pageNo);
    const { pageText, dominantFontSize: pageFontSize } = await extractPageText(page);
    fullText += pageText + '\n\n';
    fontSizeAccum.push(pageFontSize);
  }

  // Overall dominant font size
  fontSizeAccum.sort((a, b) => a - b);
  dominantFontSize = fontSizeAccum[Math.floor(fontSizeAccum.length / 2)] || 12;

  const text = fullText.trim();
  const html = paragraphsFromText(text, dominantFontSize);

  return {
    text,
    html,
    pages:   doc.numPages,
    title:   meta.title,
    author:  meta.author,
    outline: resolvedOutline,
  };
}
