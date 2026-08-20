/**
 * dictionary.js — Free Dictionary API popup for single-word lookups.
 *
 * API: https://api.dictionaryapi.dev/api/v2/entries/en/<word>
 * Free, no key required, returns phonetics, definitions, examples.
 *
 * The popup is created/destroyed on demand — no persistent DOM node.
 */

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

// Cache results to avoid repeated network calls for the same word
const cache = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function isSingleWord(text) {
  return /^[a-zA-Z'-]{2,40}$/.test(text.trim());
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
async function fetchDefinition(word) {
  const key = word.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const res = await fetch(API + encodeURIComponent(key));
  if (!res.ok) {
    const err = { error: res.status === 404
      ? `No definition found for "${word}".`
      : `Dictionary API error (${res.status}).` };
    cache.set(key, err);
    return err;
  }
  const data = await res.json();
  cache.set(key, data);
  return data;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function buildPopupHTML(data, word) {
  if (data?.error) {
    return `
      <button class="dict-close" id="dictClose" aria-label="Close">×</button>
      <div class="dict-word">${escHtml(word)}</div>
      <div class="dict-error">${escHtml(data.error)}</div>`;
  }

  const entry     = Array.isArray(data) ? data[0] : data;
  const phonetics = entry?.phonetics || [];
  const phonetic  = phonetics.find(p => p.text)?.text || '';
  const audioUrl  = phonetics.find(p => p.audio)?.audio || '';
  const meanings  = entry?.meanings || [];

  // Show up to 2 meanings, 2 definitions each
  let defsHtml = '';
  for (const m of meanings.slice(0, 2)) {
    defsHtml += `<div class="dict-pos">${escHtml(m.partOfSpeech)}</div>`;
    for (const d of (m.definitions || []).slice(0, 2)) {
      defsHtml += `<div class="dict-definition">${escHtml(d.definition)}</div>`;
      if (d.example) {
        defsHtml += `<div class="dict-example">"${escHtml(d.example)}"</div>`;
      }
    }
  }

  return `
    <button class="dict-close" id="dictClose" aria-label="Close">×</button>
    <div class="dict-word">
      ${escHtml(entry?.word || word)}
      ${audioUrl ? `<button class="dict-audio" id="dictAudio" title="Hear pronunciation">🔊 Play</button>` : ''}
    </div>
    ${phonetic ? `<div class="dict-phonetic">${escHtml(phonetic)}</div>` : ''}
    ${defsHtml || '<div class="dict-loading">No definitions available.</div>'}`;
}

// ---------------------------------------------------------------------------
// Popup lifecycle
// ---------------------------------------------------------------------------
let currentPopup = null;

function closePopup() {
  currentPopup?.remove();
  currentPopup = null;
}

function positionPopup(popup, anchorRect) {
  const pw = 340;
  const margin = 12;
  let left = anchorRect.left + anchorRect.width / 2 - pw / 2;
  left = Math.max(margin, Math.min(window.innerWidth - pw - margin, left));

  // Prefer above the selection; fall back to below
  const popH  = 240; // estimated height
  const above = anchorRect.top - margin - popH;
  const below = anchorRect.bottom + margin;
  const top   = above > 0 ? above : below;

  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
}

// ---------------------------------------------------------------------------
// Public: show dictionary popup for a single word
// ---------------------------------------------------------------------------
export async function showDictionary(word, anchorRect) {
  closePopup();
  if (!isSingleWord(word)) return;

  // Create popup immediately with a loading state
  const popup = document.createElement('div');
  popup.className = 'dict-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', `Definition of ${word}`);
  popup.innerHTML = `
    <button class="dict-close" id="dictClose" aria-label="Close">×</button>
    <div class="dict-word">${escHtml(word)}</div>
    <div class="dict-loading">Looking up definition…</div>`;
  document.body.appendChild(popup);
  currentPopup = popup;

  positionPopup(popup, anchorRect);

  popup.querySelector('#dictClose').onclick = closePopup;

  // Close on outside click
  const outsideHandler = e => {
    if (currentPopup && !currentPopup.contains(e.target)) {
      closePopup();
      document.removeEventListener('mousedown', outsideHandler, true);
    }
  };
  document.addEventListener('mousedown', outsideHandler, true);

  // Close on Escape
  const keyHandler = e => {
    if (e.key === 'Escape') { closePopup(); document.removeEventListener('keydown', keyHandler); }
  };
  document.addEventListener('keydown', keyHandler);

  // Fetch and update
  try {
    const data = await fetchDefinition(word);
    if (!currentPopup) return; // closed while fetching
    popup.innerHTML = buildPopupHTML(data, word);
    positionPopup(popup, anchorRect);

    popup.querySelector('#dictClose')?.addEventListener('click', closePopup);

    const audioBtn = popup.querySelector('#dictAudio');
    if (audioBtn) {
      const entry    = Array.isArray(data) ? data[0] : data;
      const audioUrl = entry?.phonetics?.find(p => p.audio)?.audio || '';
      audioBtn.onclick = () => { new Audio(audioUrl).play().catch(() => {}); };
    }
  } catch (err) {
    if (!currentPopup) return;
    popup.innerHTML = `
      <button class="dict-close" id="dictClose" aria-label="Close">×</button>
      <div class="dict-word">${escHtml(word)}</div>
      <div class="dict-error">Could not fetch definition. Check your connection.</div>`;
    popup.querySelector('#dictClose')?.addEventListener('click', closePopup);
  }
}

export { closePopup as closeDictionary, isSingleWord };
