/**
 * dictionary.js — Dictionary popup with bulletproof event handling.
 *
 * Key design decisions:
 * - The popup is a persistent DOM element (created once, shown/hidden).
 * - Outside-click uses a 'pointerdown' listener with a small guard flag
 *   so the same pointer event that opens the popup never closes it.
 * - No capture-phase listeners. No setTimeout races.
 */

const API_FREE     = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const API_DATAMUSE = 'https://api.datamuse.com/words?sp=';

export function isSingleWord(text) {
  return /^[a-zA-Z'-]{2,40}$/.test(text.trim());
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
function h(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
const cache = new Map();

async function fetchFreeDictionary(word) {
  const res = await fetch(API_FREE + encodeURIComponent(word),
    { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  const e = data[0];
  return {
    word:     e.word || word,
    phonetic: e.phonetics?.find(p => p.text)?.text || '',
    audio:    e.phonetics?.find(p => p.audio)?.audio || '',
    meanings: (e.meanings || []).slice(0, 2).map(m => ({
      pos:  m.partOfSpeech,
      defs: (m.definitions || []).slice(0, 2).map(d => ({
        def: d.definition, ex: d.example || '',
      })),
    })),
  };
}

async function fetchDatamuse(word) {
  const res = await fetch(
    `${API_DATAMUSE}${encodeURIComponent(word)}&md=d&max=3`,
    { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const data = await res.json();
  const match = data.find(d => d.word.toLowerCase() === word.toLowerCase()) || data[0];
  if (!match?.defs?.length) return null;
  const groups = {};
  for (const raw of match.defs) {
    const t = raw.indexOf('\t');
    if (t < 0) continue;
    const pos = raw.slice(0, t), def = raw.slice(t + 1);
    (groups[pos] = groups[pos] || []).push({ def, ex: '' });
  }
  const meanings = Object.entries(groups).slice(0, 2)
    .map(([pos, defs]) => ({ pos, defs: defs.slice(0, 2) }));
  if (!meanings.length) return null;
  return { word: match.word || word, phonetic: '', audio: '', meanings };
}

async function lookup(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let result = null;
  try { result = await fetchFreeDictionary(word); } catch {}
  if (!result) { try { result = await fetchDatamuse(word); } catch {} }
  cache.set(key, result || { error: true, word });
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// Popup element — created once, reused
// ---------------------------------------------------------------------------
let popup       = null;
let isOpen      = false;
let justOpened  = false;   // guard flag: true for one tick after open

function ensurePopup() {
  if (popup) return popup;
  popup = document.createElement('div');
  popup.className = 'dict-popup';
  popup.setAttribute('role', 'dialog');
  popup.style.display = 'none';
  document.body.appendChild(popup);

  // Outside-click: only fires if justOpened is false
  document.addEventListener('pointerdown', e => {
    if (!isOpen || justOpened) return;
    if (!popup.contains(e.target)) closeDictionary();
  }, true);

  // Escape key
  document.addEventListener('keydown', e => {
    if (isOpen && e.key === 'Escape') closeDictionary();
  });

  return popup;
}

function showPopup(anchorRect) {
  const p   = ensurePopup();
  const pw  = Math.min(340, window.innerWidth - 24);
  const mar = 12;
  let left  = anchorRect.left + anchorRect.width / 2 - pw / 2;
  left = Math.max(mar, Math.min(window.innerWidth - pw - mar, left));
  const popH  = 220;
  const above = anchorRect.top  - mar - popH;
  const below = anchorRect.bottom + mar;
  const top   = above > 70 ? above : below;

  p.style.cssText = `
    display:block;
    left:${left}px;
    top:${Math.max(70, top)}px;
    width:${pw}px;
  `;
  isOpen = true;

  // Guard: ignore the pointerdown that opened us
  justOpened = true;
  requestAnimationFrame(() => { justOpened = false; });
}

export function closeDictionary() {
  if (popup) popup.style.display = 'none';
  isOpen = false;
}

// ---------------------------------------------------------------------------
// Content rendering
// ---------------------------------------------------------------------------
function renderLoading(word) {
  ensurePopup().innerHTML = `
    <button class="dict-close" id="dc">×</button>
    <div class="dict-word">${h(word)}</div>
    <div class="dict-loading">Looking up definition…</div>`;
  popup.querySelector('#dc').onclick = closeDictionary;
}

function renderResult(data) {
  const p = ensurePopup();
  if (!data || data.error) {
    p.innerHTML = `
      <button class="dict-close" id="dc">×</button>
      <div class="dict-word">${h(data?.word || '')}</div>
      <div class="dict-error">No definition found. Try the base form of the word.</div>`;
    p.querySelector('#dc').onclick = closeDictionary;
    return;
  }

  let defsHtml = '';
  for (const m of data.meanings) {
    defsHtml += `<div class="dict-pos">${h(m.pos)}</div>`;
    for (const d of m.defs) {
      defsHtml += `<div class="dict-definition">${h(d.def)}</div>`;
      if (d.ex) defsHtml += `<div class="dict-example">"${h(d.ex)}"</div>`;
    }
  }

  p.innerHTML = `
    <button class="dict-close" id="dc">×</button>
    <div class="dict-word">
      ${h(data.word)}
      ${data.audio ? `<button class="dict-audio" id="da">🔊</button>` : ''}
    </div>
    ${data.phonetic ? `<div class="dict-phonetic">${h(data.phonetic)}</div>` : ''}
    ${defsHtml || '<div class="dict-loading">No definitions available.</div>'}`;

  p.querySelector('#dc').onclick = closeDictionary;
  if (data.audio) {
    p.querySelector('#da').onclick = () => new Audio(data.audio).play().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function showDictionary(word, anchorRect) {
  if (!isSingleWord(word)) return;

  renderLoading(word);
  showPopup(anchorRect);

  const data = await lookup(word);
  // Only update if still open (user may have closed while fetching)
  if (!isOpen) return;
  renderResult(data);
  // Re-position after content renders (height may have changed)
  requestAnimationFrame(() => showPopup(anchorRect));
}
