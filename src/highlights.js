/**
 * highlights.js — highlight storage, application, multi-color support
 *
 * v3.1 changes:
 *  - createHighlightRecord accepts a `color` param (yellow/green/blue/pink/orange)
 *  - applyHighlightToPage sets data-color on the <mark> so CSS can colour it
 *  - wrapRange returns the created mark element so callers can set data-color
 */

import { uid } from './utils.js';

export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow', hex: '#fef08a' },
  { id: 'green',  label: 'Green',  hex: '#bbf7d0' },
  { id: 'blue',   label: 'Blue',   hex: '#bae6fd' },
  { id: 'pink',   label: 'Pink',   hex: '#fbcfe8' },
  { id: 'orange', label: 'Orange', hex: '#fed7aa' },
];

// ---------------------------------------------------------------------------
// Text-node walker — used consistently everywhere
// ---------------------------------------------------------------------------
function allTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

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
// Core DOM wrap — returns the <mark> element or null on failure
// ---------------------------------------------------------------------------
function wrapRange(root, start, end, color = 'yellow') {
  if (start < 0 || start >= end) return null;
  const nodes = allTextNodes(root);
  if (!nodes.length) return null;

  let pos = 0;
  let startNode, startLocal, endNode, endLocal;

  for (const n of nodes) {
    const nEnd = pos + n.nodeValue.length;
    if (startNode === undefined && start >= pos && start <= nEnd) {
      startNode = n; startLocal = start - pos;
    }
    if (endNode === undefined && end >= pos && end <= nEnd) {
      endNode = n; endLocal = end - pos; break;
    }
    pos = nEnd;
  }

  if (!startNode || !endNode) return null;

  try {
    const r = document.createRange();
    r.setStart(startNode, startLocal);
    r.setEnd(endNode, endLocal);
    if (r.collapsed) return null;
    const mark = document.createElement('mark');
    mark.className = 'reader-highlight';
    mark.dataset.color = color;
    mark.appendChild(r.extractContents());
    r.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text-search fallback
// ---------------------------------------------------------------------------
function applyByTextSearch(root, target, color) {
  const nodes = allTextNodes(root);
  if (!nodes.length || !target) return false;

  const chars = [];
  for (const n of nodes) {
    for (let i = 0; i < n.nodeValue.length; i++) chars.push({ node: n, idx: i });
  }

  const rawText  = chars.map(c => c.node.nodeValue[c.idx]).join('');
  const normText = rawText.replace(/\s+/g, ' ');
  const normTgt  = target.replace(/\s+/g, ' ');
  const at       = normText.indexOf(normTgt);
  if (at < 0) return false;

  function normToRaw(normPos) {
    let norm = 0, raw = 0;
    while (raw < rawText.length) {
      if (/\s/.test(rawText[raw])) {
        if (norm === normPos) return raw;
        norm++;
        while (raw < rawText.length && /\s/.test(rawText[raw])) raw++;
      } else {
        if (norm === normPos) return raw;
        norm++; raw++;
      }
    }
    return raw;
  }

  return !!wrapRange(root, normToRaw(at), normToRaw(at + normTgt.length), color);
}

// ---------------------------------------------------------------------------
// Public: apply a single highlight record to a .book-page section
// ---------------------------------------------------------------------------
export function applyHighlightToPage(section, h) {
  if (!section || !h?.text) return;
  const color = h.color || 'yellow';

  // Path 1 — stable paragraphId + intra-paragraph offsets
  if (h.paragraphId && typeof h.startInParagraph === 'number' && h.startInParagraph < h.endInParagraph) {
    const para = section.querySelector(`[data-pid="${h.paragraphId}"]`);
    if (para && wrapRange(para, h.startInParagraph, h.endInParagraph, color)) return;
  }

  // Path 2 — section-level char offsets
  if (typeof h.sectionStart === 'number' && h.sectionStart < h.sectionEnd) {
    if (wrapRange(section, h.sectionStart, h.sectionEnd, color)) return;
  }

  // Path 3 — text search
  applyByTextSearch(section, h.text, color);
}

// ---------------------------------------------------------------------------
// Public: apply all highlights for currently rendered page(s)
// ---------------------------------------------------------------------------
export function applyStoredHighlights(highlights, physicalPage) {
  if (!highlights?.length) return;
  const sections = [...document.querySelectorAll('#readingText .book-page')];
  if (!sections.length) return;
  for (const h of highlights) {
    const hPage = Number(h.page);
    for (let i = 0; i < sections.length; i++) {
      if (hPage === physicalPage + i) {
        applyHighlightToPage(sections[i], h);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public: remove all highlight marks
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

  let paragraphId = null, startInParagraph = null, endInParagraph = null;
  let el = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement : range.startContainer;
  while (el && el !== reader) {
    if (el.dataset?.pid) {
      paragraphId      = el.dataset.pid;
      startInParagraph = offsetOfRangeStart(range, el);
      endInParagraph   = offsetOfRangeEnd(range, el);
      break;
    }
    el = el.parentElement;
  }

  // Find which .book-page section the selection starts in
  const section = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement?.closest('.book-page')
    : range.startContainer.closest?.('.book-page');

  const sectionStart = section ? offsetOfRangeStart(range, section) : null;
  const sectionEnd   = section ? offsetOfRangeEnd(range, section)   : null;

  // Determine the section index (0 = left/only page, 1 = right spread page)
  // so the caller can compute the correct physical page number.
  let sectionIndex = 0;
  if (section) {
    const allSections = [...document.querySelectorAll('#readingText .book-page')];
    sectionIndex = allSections.indexOf(section);
    if (sectionIndex < 0) sectionIndex = 0;
  }

  return {
    sel,
    range: range.cloneRange(),
    text,
    paragraphId, startInParagraph, endInParagraph,
    sectionStart, sectionEnd,
    sectionIndex,   // 0 for left/single page, 1 for right spread page
  };
}

// ---------------------------------------------------------------------------
// Public: build a highlight record
// ---------------------------------------------------------------------------
export function createHighlightRecord(selection, page, note = '', color = 'yellow') {
  return {
    id:               uid(),
    // Add sectionIndex offset so right-page highlights store the correct
    // physical page number (page + 1 for the right spread page)
    page:             page + (selection.sectionIndex || 0),
    text:             selection.text,
    note:             note || '',
    color,
    paragraphId:      selection.paragraphId,
    startInParagraph: selection.startInParagraph,
    endInParagraph:   selection.endInParagraph,
    sectionStart:     selection.sectionStart,
    sectionEnd:       selection.sectionEnd,
    createdAt:        new Date().toISOString(),
  };
}
