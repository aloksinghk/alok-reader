/**
 * dictionary.js
 *
 * Event strategy (final, no more races):
 *  - showDictionary() is ONLY ever called from a 'click' handler.
 *    click fires AFTER the full mousedown→mouseup→click chain completes,
 *    so by the time showDictionary runs, all mousedown side effects are done.
 *  - The popup closes on the NEXT click outside it, registered via a
 *    single document 'click' listener added with { once: true } after a
 *    requestAnimationFrame delay (so the originating click doesn't close it).
 *  - No pointerdown, no mousedown, no capture phase, no setTimeout races.
 */

const API_FREE     = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const API_DATAMUSE = 'https://api.datamuse.com/words?sp=';

export function isSingleWord(text) {
  return /^[a-zA-Z'-]{2,40}$/.test(text.trim());
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const cache = new Map();

async function fetchFreeDictionary(word) {
  try {
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
  } catch { return null; }
}

async function fetchDatamuse(word) {
  try {
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
  } catch { return null; }
}

async function lookup(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const result = (await fetchFreeDictionary(word)) || (await fetchDatamuse(word)) || { error: true, word };
  cache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Popup DOM (created once, reused)
// ---------------------------------------------------------------------------
let popup  = null;
let isOpen = false;

function getPopup() {
  if (!popup) {
    popup = document.createElement('div');
    popup.className = 'dict-popup';
    popup.setAttribute('role', 'dialog');
    popup.style.display = 'none';
    document.body.appendChild(popup);

    // Escape key always closes
    document.addEventListener('keydown', e => {
      if (isOpen && e.key === 'Escape') closeDictionary();
    });
  }
  return popup;
}

function position(p, anchorRect) {
  const pw  = Math.min(320, window.innerWidth - 24);
  const mar = 12;
  let left  = anchorRect.left + anchorRect.width / 2 - pw / 2;
  left = Math.max(mar, Math.min(window.innerWidth - pw - mar, left));
  const popH  = p.offsetHeight || 200;
  const above = anchorRect.top - mar - popH;
  const below = anchorRect.bottom + mar;
  const top   = above > 70 ? above : below;
  p.style.left  = left + 'px';
  p.style.top   = Math.max(70, top) + 'px';
  p.style.width = pw + 'px';
}

export function closeDictionary() {
  if (popup) popup.style.display = 'none';
  isOpen = false;
}

function open(anchorRect) {
  const p = getPopup();
  p.style.display = 'block';
  isOpen = true;
  position(p, anchorRect);

  // Register a one-shot click listener on the next animation frame
  // so the click that triggered showDictionary() doesn't fire it.
  requestAnimationFrame(() => {
    if (!isOpen) return;
    document.addEventListener('click', function handler(e) {
      if (!isOpen) return;
      if (popup && popup.contains(e.target)) return; // click inside popup = ignore
      closeDictionary();
      document.removeEventListener('click', handler);
    });
  });
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
function setContent(html) {
  const p = getPopup();
  p.innerHTML = html;
  p.querySelector('.dc')?.addEventListener('click', closeDictionary);
  p.querySelector('.da')?.addEventListener('click', () => {
    const url = p.querySelector('.da')?.dataset.audio;
    if (url) new Audio(url).play().catch(() => {});
  });
}

function loadingHTML(word) {
  return `
    <button class="dict-close dc">×</button>
    <div class="dict-word">${esc(word)}</div>
    <div class="dict-loading">Looking up…</div>`;
}

function resultHTML(data) {
  if (!data || data.error) {
    return `
      <button class="dict-close dc">×</button>
      <div class="dict-word">${esc(data?.word || '')}</div>
      <div class="dict-error">No definition found. Try the base form.</div>`;
  }
  let defs = '';
  for (const m of data.meanings) {
    defs += `<div class="dict-pos">${esc(m.pos)}</div>`;
    for (const d of m.defs) {
      defs += `<div class="dict-definition">${esc(d.def)}</div>`;
      if (d.ex) defs += `<div class="dict-example">"${esc(d.ex)}"</div>`;
    }
  }
  return `
    <button class="dict-close dc">×</button>
    <div class="dict-word">
      ${esc(data.word)}
      ${data.audio
        ? `<button class="dict-audio da" data-audio="${esc(data.audio)}" title="Play pronunciation">🔊</button>`
        : ''}
    </div>
    ${data.phonetic ? `<div class="dict-phonetic">${esc(data.phonetic)}</div>` : ''}
    ${defs || '<div class="dict-loading">No definitions found.</div>'}`;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
export async function showDictionary(word, anchorRect) {
  if (!isSingleWord(word)) return;
  setContent(loadingHTML(word));
  open(anchorRect);

  const data = await lookup(word);
  if (!isOpen) return;                    // closed while fetching
  setContent(resultHTML(data));
  requestAnimationFrame(() => position(getPopup(), anchorRect));
}
