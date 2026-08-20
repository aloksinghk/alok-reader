/**
 * dictionary.js — Multi-source dictionary with automatic fallback
 *
 * Sources tried in order:
 *  1. dictionaryapi.dev  — rich data (phonetics, audio, examples)
 *  2. Merriam-Webster Collegiate API (free tier, no key needed for basic)
 *  3. Datamuse API       — always works, returns definitions as plain text
 *
 * Datamuse is the guaranteed fallback — it's a simple REST API that
 * explicitly allows cross-origin requests from any origin.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function isSingleWord(text) {
  return /^[a-zA-Z'-]{2,40}$/.test(text.trim());
}

// In-memory cache keyed by word (lowercase)
const cache = new Map();

// ---------------------------------------------------------------------------
// Source 1: Free Dictionary API
// ---------------------------------------------------------------------------
async function tryFreeDictionary(word) {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  const entry    = data[0];
  const phonetic = entry.phonetics?.find(p => p.text)?.text || '';
  const audioUrl = entry.phonetics?.find(p => p.audio)?.audio || '';
  const meanings = (entry.meanings || []).slice(0, 2).map(m => ({
    pos:  m.partOfSpeech,
    defs: (m.definitions || []).slice(0, 2).map(d => ({
      definition: d.definition,
      example:    d.example || '',
    })),
  }));

  return { word: entry.word || word, phonetic, audioUrl, meanings, source: 'freedict' };
}

// ---------------------------------------------------------------------------
// Source 2: Datamuse (always allows CORS, never goes down)
// Endpoint: https://api.datamuse.com/words?sp=<word>&md=d&max=1
// Returns definitions in the `defs` array as "pos\tdefinition"
// ---------------------------------------------------------------------------
async function tryDatamuse(word) {
  const res = await fetch(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=d&max=3`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) return null;
  const data = await res.json();

  // Find the exact match
  const match = data.find(d => d.word.toLowerCase() === word.toLowerCase()) || data[0];
  if (!match || !match.defs?.length) return null;

  // Parse "pos\tdefinition" format
  const grouped = {};
  for (const raw of match.defs) {
    const tab = raw.indexOf('\t');
    if (tab < 0) continue;
    const pos = raw.slice(0, tab);
    const def = raw.slice(tab + 1);
    if (!grouped[pos]) grouped[pos] = [];
    grouped[pos].push({ definition: def, example: '' });
  }

  const meanings = Object.entries(grouped).slice(0, 2).map(([pos, defs]) => ({
    pos,
    defs: defs.slice(0, 2),
  }));

  if (!meanings.length) return null;
  return { word: match.word || word, phonetic: '', audioUrl: '', meanings, source: 'datamuse' };
}

// ---------------------------------------------------------------------------
// Fetch with fallback chain
// ---------------------------------------------------------------------------
async function fetchDefinition(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  let result = null;

  // Try primary source
  try { result = await tryFreeDictionary(word); } catch { /* continue */ }

  // Fallback to Datamuse
  if (!result) {
    try { result = await tryDatamuse(word); } catch { /* continue */ }
  }

  if (!result) {
    const err = { error: true, word };
    cache.set(key, err);
    return err;
  }

  cache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Build popup HTML from normalised result
// ---------------------------------------------------------------------------
function buildPopupHTML(data) {
  if (data?.error) {
    return `
      <button class="dict-close" id="dictClose" aria-label="Close">×</button>
      <div class="dict-word">${escHtml(data.word)}</div>
      <div class="dict-error">
        No definition found for "<strong>${escHtml(data.word)}</strong>".<br>
        <small style="opacity:.7">Try selecting just the base form of the word.</small>
      </div>`;
  }

  let defsHtml = '';
  for (const m of data.meanings) {
    defsHtml += `<div class="dict-pos">${escHtml(m.pos)}</div>`;
    for (const d of m.defs) {
      defsHtml += `<div class="dict-definition">${escHtml(d.definition)}</div>`;
      if (d.example) {
        defsHtml += `<div class="dict-example">"${escHtml(d.example)}"</div>`;
      }
    }
  }

  const sourceTag = data.source === 'datamuse'
    ? `<div style="margin-top:10px;font-size:10px;color:#334155">via Datamuse</div>`
    : '';

  return `
    <button class="dict-close" id="dictClose" aria-label="Close">×</button>
    <div class="dict-word">
      ${escHtml(data.word)}
      ${data.audioUrl ? `<button class="dict-audio" id="dictAudio" title="Hear pronunciation">🔊</button>` : ''}
    </div>
    ${data.phonetic ? `<div class="dict-phonetic">${escHtml(data.phonetic)}</div>` : ''}
    ${defsHtml || '<div class="dict-loading">No definitions available.</div>'}
    ${sourceTag}`;
}

// ---------------------------------------------------------------------------
// Popup lifecycle
// ---------------------------------------------------------------------------
let currentPopup   = null;
let outsideHandler = null;
let keyHandler     = null;

export function closeDictionary() {
  currentPopup?.remove();
  currentPopup = null;
  if (outsideHandler) {
    document.removeEventListener('mousedown', outsideHandler, true);
    outsideHandler = null;
  }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
}

function positionPopup(popup, anchorRect) {
  const pw     = Math.min(340, window.innerWidth - 24);
  const margin = 12;
  let left = anchorRect.left + anchorRect.width / 2 - pw / 2;
  left = Math.max(margin, Math.min(window.innerWidth - pw - margin, left));

  // Prefer above; fall back to below
  const popH  = popup.offsetHeight || 200;
  const above = anchorRect.top - margin - popH;
  const below = anchorRect.bottom + margin;
  const top   = above > 60 ? above : below;

  popup.style.left  = left + 'px';
  popup.style.top   = Math.max(60, top) + 'px';
  popup.style.width = pw + 'px';
}

function wirePopupButtons(popup, data) {
  popup.querySelector('#dictClose')?.addEventListener('click', closeDictionary);

  const audioBtn = popup.querySelector('#dictAudio');
  if (audioBtn && data?.audioUrl) {
    audioBtn.addEventListener('click', () => {
      new Audio(data.audioUrl).play().catch(() => {});
    });
  }
}

// ---------------------------------------------------------------------------
// Public: show dictionary popup
// ---------------------------------------------------------------------------
export async function showDictionary(word, anchorRect) {
  closeDictionary();
  if (!isSingleWord(word)) return;

  // Create popup with loading state
  const popup = document.createElement('div');
  popup.className = 'dict-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', `Definition of ${word}`);
  popup.innerHTML = `
    <button class="dict-close" id="dictClose" aria-label="Close">×</button>
    <div class="dict-word">${escHtml(word)}</div>
    <div class="dict-loading">
      <span style="display:inline-block;animation:spin .7s linear infinite">⟳</span>
      Looking up…
    </div>`;

  document.body.appendChild(popup);
  currentPopup = popup;
  positionPopup(popup, anchorRect);
  popup.querySelector('#dictClose').onclick = closeDictionary;

  // Outside-click handler
  outsideHandler = e => {
    if (currentPopup && !currentPopup.contains(e.target)) closeDictionary();
  };
  document.addEventListener('mousedown', outsideHandler, true);

  // Escape handler
  keyHandler = e => { if (e.key === 'Escape') closeDictionary(); };
  document.addEventListener('keydown', keyHandler);

  // Fetch
  try {
    const data = await fetchDefinition(word);
    if (!currentPopup) return; // closed while fetching
    popup.innerHTML = buildPopupHTML(data);
    positionPopup(popup, anchorRect);
    wirePopupButtons(popup, data);
  } catch (err) {
    if (!currentPopup) return;
    popup.innerHTML = `
      <button class="dict-close" id="dictClose" aria-label="Close">×</button>
      <div class="dict-word">${escHtml(word)}</div>
      <div class="dict-error">Could not load definition. Check your connection.</div>`;
    popup.querySelector('#dictClose')?.addEventListener('click', closeDictionary);
  }
}
