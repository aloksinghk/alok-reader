/**
 * highlights.js — highlight storage, application and selection tooling
 *
 * Improvements over v2.15.2:
 *  - Highlights are stored with { paragraphId, startInParagraph, endInParagraph }
 *    in addition to the raw text, so they survive repagination and font changes.
 *  - The apply function first tries the stable paragraph-offset path, then falls
 *    back to the legacy text-search path for existing highlights.
 *  - All DOM manipulation is isolated here; the reader module calls these functions.
 */

import { uid } from './utils.js';

// ---------------------------------------------------------------------------
// Text-node helpers
// ---------------------------------------------------------------------------

function textNodesIn(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.nodeValue?.trim()
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT,
  });
  const out = [];
  let n;
  while ((n = walker.nextNode())) out.push(n);
  return out;
}

/**
 * Walk text nodes in root and return the character offset of range.startContainer/startOffset.
 */
function getStartOffset(range, root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  while ((n = walker.nextNode())) {
    if (n === range.startContainer) return pos + range.startOffset;
    pos += n.nodeValue.length;
  }
  return 0;
}

/**
 * Walk text nodes in root and return the character offset of range.endContainer/endOffset.
 */
function getEndOffset(range, root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  while ((n = walker.nextNode())) {
    if (n === range.endContainer) return pos + range.endOffset;
    pos += n.nodeValue.length;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// DOM wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap a character range [start, end) across text nodes inside root with a
 * <mark class="reader-highlight"> element.
 */
function wrapRange(root, start, end) {
  const nodes = textNodesIn(root);
  if (!nodes.length || start >= end) return false;

  let pos = 0, startNode, endNode, startLocal, endLocal;
  for (const n of nodes) {
    const nEnd = pos + n.nodeValue.length;
    if (!startNode && start >= pos && start <= nEnd) {
      startNode  = n;
      startLocal = start - pos;
    }
    if (end >= pos && end <= nEnd) {
      endNode  = n;
      endLocal = end - pos;
      break;
    }
    pos = nEnd;
  }

  if (!startNode || !endNode) return false;

  try {
    const range = document.createRange();
    range.setStart(startNode, startLocal);
    range.setEnd(endNode, endLocal);
    const mark = document.createElement('mark');
    mark.className = 'reader-highlight';
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Apply highlights to rendered DOM
// ---------------------------------------------------------------------------

/**
 * Apply a single highlight to the rendered reader page using the stable
 * paragraph-ID path first, then the legacy text-search fallback.
 *
 * @param {HTMLElement} pageSection   The .book-page element
 * @param {Object}      h             Highlight record
 */
export function applyHighlightToPage(pageSection, h) {
  if (!pageSection || !h?.text) return;

  // --- Path 1: paragraph-ID + intra-paragraph offsets (new format) ---
  if (h.paragraphId && typeof h.startInParagraph === 'number') {
    const para = pageSection.querySelector(`[data-pid="${h.paragraphId}"]`);
    if (para) {
      const ok = wrapRange(para, h.startInParagraph, h.endInParagraph);
      if (ok) return;
    }
  }

  // --- Path 2: page-level character offsets (v2.15.2 format) ---
  if (typeof h.startOffset === 'number' && typeof h.endOffset === 'number') {
    const ok = wrapRange(pageSection, h.startOffset, h.endOffset);
    if (ok) return;
  }

  // --- Path 3: text-search fallback ---
  const target = h.text.trim().replace(/\s+/g, ' ');
  if (!target) return;
  const nodes   = textNodesIn(pageSection);
  let combined  = '';
  const offsets = [];
  for (const n of nodes) {
    offsets.push(combined.length);
    combined += n.nodeValue.replace(/\s+/g, ' ');
  }
  const at = combined.indexOf(target);
  if (at < 0) return;
  wrapRange(pageSection, at, at + target.length);
}

/**
 * Apply all stored highlights for the current book to the currently rendered
 * .book-page sections.
 *
 * @param {Array}       highlights   Array of highlight records
 * @param {number}      physicalPage Current 0-based physical page index
 */
export function applyStoredHighlights(highlights, physicalPage) {
  if (!highlights?.length) return;
  const sections = [...document.querySelectorAll('#readingText .book-page')];
  for (const h of highlights) {
    const pageDelta = Number(h.page) - physicalPage;
    if (pageDelta >= 0 && pageDelta < sections.length) {
      applyHighlightToPage(sections[pageDelta], h);
    }
  }
}

/** Remove all <mark class="reader-highlight"> nodes from the reading area. */
export function removeHighlightMarks() {
  document.querySelectorAll('#readingText mark.reader-highlight').forEach(m => {
    const p = m.parentNode;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    p.normalize();
  });
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/**
 * Return the current text selection if it is inside #readingText.
 * @returns {{ sel, range, text, paragraphId, startInParagraph, endInParagraph } | null}
 */
export function getActiveSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range  = sel.getRangeAt(0);
  const reader = document.getElementById('readingText');
  if (!reader || !reader.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString().trim().replace(/\s+/g, ' ');
  if (!text) return null;

  // Try to find the paragraph the selection starts in
  let paragraphId        = null;
  let startInParagraph   = null;
  let endInParagraph     = null;

  // Walk up from the start container to find a [data-pid] ancestor
  let el = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : range.startContainer;
  while (el && el !== reader) {
    if (el.dataset?.pid) {
      paragraphId      = el.dataset.pid;
      startInParagraph = getStartOffset(range, el);
      endInParagraph   = getEndOffset(range, el);
      break;
    }
    el = el.parentElement;
  }

  // Page-level offsets (legacy path)
  const startOffset = getStartOffset(range, reader);
  const endOffset   = getEndOffset(range, reader);

  return { sel, range, text, paragraphId, startInParagraph, endInParagraph, startOffset, endOffset };
}

// ---------------------------------------------------------------------------
// Highlight record factory
// ---------------------------------------------------------------------------

/**
 * Create a new highlight record from a selection result.
 *
 * @param {Object} selection   Result of getActiveSelection()
 * @param {number} page        Current physical page index
 * @param {string} note        Optional note text
 * @returns {Object}           Highlight record ready to store
 */
export function createHighlightRecord(selection, page, note = '') {
  return {
    id:               uid(),
    page,
    text:             selection.text,
    note:             note || '',
    // Stable paragraph-based offsets (new)
    paragraphId:      selection.paragraphId,
    startInParagraph: selection.startInParagraph,
    endInParagraph:   selection.endInParagraph,
    // Legacy page-level offsets (kept for backward compat)
    startOffset:      selection.startOffset,
    endOffset:        selection.endOffset,
    createdAt:        new Date().toISOString(),
  };
}
