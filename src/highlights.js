/**
 * highlights.js — highlight storage, application and selection tooling
 */

import { uid } from './utils.js';

// ---------------------------------------------------------------------------
// Text-node walker (used consistently everywhere)
// ---------------------------------------------------------------------------

function allTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

// ---------------------------------------------------------------------------
// Offset helpers — always scoped to a specific root element
// ---------------------------------------------------------------------------

function offsetOfRangeStart(range, root) {
  let pos = 0;
  for (const n of allTextNodes(root)) {
    if (n === range.startContainer) return pos + range.startOffset;
    pos += n.nodeValue.length;
  }
  return 0;
}

function offsetOfRangeEnd(range, root) {
  let pos = 0;
  for (const n of allTextNodes(root)) {
    if (n === range.endContainer) return pos + range.endOffset;
    pos += n.nodeValue.length;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Core DOM wrap — applies a [start, end) char range inside root
// ---------------------------------------------------------------------------

function wrapRange(root, start, end) {
  if (start < 0 || start >= end) return false;
  const nodes = allTextNodes(root);
  if (!nodes.length) return false;

  let pos = 0;
  let startNode, startLocal, endNode, endLocal;

  for (const n of nodes) {
    const len  = n.nodeValue.length;
    const nEnd = pos + len;

    if (startNode === undefined && start >= pos && start <= nEnd) {
      startNode  = n;
      startLocal = start - pos;
    }
    if (endNode === undefined && end >= pos && end <= nEnd) {
      endNode  = n;
      endLocal = end - pos;
      break;
    }
    pos = nEnd;
  }

  if (!startNode || !endNode) return false;

  try {
    const r = document.createRange();
    r.setStart(startNode, startLocal);
    r.setEnd(endNode, endLocal);
    if (r.collapsed) return false;
    const mark = document.createElement('mark');
    mark.className = 'reader-highlight';
    mark.appendChild(r.extractContents());
    r.insertNode(mark);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Text-search fallback
// ---------------------------------------------------------------------------

/**
 * Find `target` text inside `root` by scanning all text nodes,
 * then wrap it. Handles whitespace normalisation.
 */
function applyByTextSearch(root, target) {
  const nodes = allTextNodes(root);
  if (!nodes.length || !target) return false;

  // Build a plain-text string and a parallel char→node map
  const chars = []; // each entry: { node, indexInNode }
  for (const n of nodes) {
    for (let i = 0; i < n.nodeValue.length; i++) {
      chars.push({ node: n, idx: i });
    }
  }

  const rawText  = chars.map(c => c.node.nodeValue[c.idx]).join('');
  const normText = rawText.replace(/\s+/g, ' ');
  const normTgt  = target.replace(/\s+/g, ' ');
  const at       = normText.indexOf(normTgt);
  if (at < 0) return false;

  // Map normalised positions back to raw positions via a simple scan
  function normToRaw(normPos) {
    let norm = 0, raw = 0;
    while (raw < rawText.length) {
      // collapse a run of whitespace to one space in normalised
      if (/\s/.test(rawText[raw])) {
        if (norm === normPos) return raw;
        norm++;
        while (raw < rawText.length && /\s/.test(rawText[raw])) raw++;
      } else {
        if (norm === normPos) return raw;
        norm++;
        raw++;
      }
    }
    return raw;
  }

  const rawStart = normToRaw(at);
  const rawEnd   = normToRaw(at + normTgt.length);
  return wrapRange(root, rawStart, rawEnd);
}

// ---------------------------------------------------------------------------
// Public: apply a single highlight record to a .book-page element
// ---------------------------------------------------------------------------

export function applyHighlightToPage(section, h) {
  if (!section || !h?.text) return;

  // Path 1 — paragraphId + intra-paragraph char offsets (stable across repagination)
  if (h.paragraphId && typeof h.startInParagraph === 'number' && h.startInParagraph < h.endInParagraph) {
    const para = section.querySelector(`[data-pid="${h.paragraphId}"]`);
    if (para && wrapRange(para, h.startInParagraph, h.endInParagraph)) return;
  }

  // Path 2 — section-level char offsets (stored relative to .book-page)
  if (typeof h.sectionStart === 'number' && h.sectionStart < h.sectionEnd) {
    if (wrapRange(section, h.sectionStart, h.sectionEnd)) return;
  }

  // Path 3 — text search fallback (works even when pagination changed)
  applyByTextSearch(section, h.text);
}

// ---------------------------------------------------------------------------
// Public: apply all highlights for the current physical page(s)
// ---------------------------------------------------------------------------

export function applyStoredHighlights(highlights, physicalPage) {
  if (!highlights?.length) return;

  // sections[0] = left/only page, sections[1] = right spread page
  const sections = [...document.querySelectorAll('#readingText .book-page')];
  if (!sections.length) return;

  for (const h of highlights) {
    const hPage = Number(h.page);
    // Check each rendered section
    for (let i = 0; i < sections.length; i++) {
      if (hPage === physicalPage + i) {
        applyHighlightToPage(sections[i], h);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public: remove all highlight marks from the reading area
// ---------------------------------------------------------------------------

export function removeHighlightMarks() {
  document.querySelectorAll('#readingText mark.reader-highlight').forEach(m => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  });
}

// ---------------------------------------------------------------------------
// Public: capture current text selection
// ---------------------------------------------------------------------------

export function getActiveSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;

  const range  = sel.getRangeAt(0);
  const reader = document.getElementById('readingText');
  if (!reader || !reader.contains(range.commonAncestorContainer)) return null;

  const text = sel.toString().trim().replace(/\s+/g, ' ');
  if (!text) return null;

  // Find the nearest [data-pid] ancestor of the selection start
  let paragraphId      = null;
  let startInParagraph = null;
  let endInParagraph   = null;

  let el = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer;
  while (el && el !== reader) {
    if (el.dataset?.pid) {
      paragraphId      = el.dataset.pid;
      startInParagraph = offsetOfRangeStart(range, el);
      endInParagraph   = offsetOfRangeEnd(range, el);
      break;
    }
    el = el.parentElement;
  }

  // Section-level offsets — scoped to the .book-page, not #readingText
  // This ensures they match what wrapRange sees when re-applying.
  const section = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement?.closest('.book-page')
    : range.startContainer.closest?.('.book-page');

  const sectionStart = section ? offsetOfRangeStart(range, section) : null;
  const sectionEnd   = section ? offsetOfRangeEnd(range, section)   : null;

  // Clone range before removeAllRanges() invalidates it
  const frozenRange = range.cloneRange();

  return {
    sel,
    range:           frozenRange,
    text,
    paragraphId,
    startInParagraph,
    endInParagraph,
    sectionStart,
    sectionEnd,
  };
}

// ---------------------------------------------------------------------------
// Public: build a highlight record from a captured selection
// ---------------------------------------------------------------------------

export function createHighlightRecord(selection, page, note = '') {
  return {
    id:               uid(),
    page,
    text:             selection.text,
    note:             note || '',
    paragraphId:      selection.paragraphId,
    startInParagraph: selection.startInParagraph,
    endInParagraph:   selection.endInParagraph,
    sectionStart:     selection.sectionStart,
    sectionEnd:       selection.sectionEnd,
    createdAt:        new Date().toISOString(),
  };
}
