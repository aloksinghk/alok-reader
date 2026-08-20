/**
 * utils.js — shared utility functions
 */

/**
 * Escape a string for safe insertion as HTML text content.
 * Exported as a named export so other modules can import it from utils.js.
 */
export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function uid() {
  return crypto.randomUUID?.() || String(Date.now() + Math.random());
}

/**
 * Return the display title for a book record.
 */
export function titleOf(b) {
  return b.title || b.name.replace(/\.pdf$/i, '');
}

/**
 * Shorthand querySelector on the document.
 */
export const $ = s => document.querySelector(s);

/**
 * Show a non-blocking toast notification at the bottom of the screen.
 * @param {string} message
 * @param {'info'|'error'|'success'} type
 * @param {number} duration  ms before auto-dismiss
 */
export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger CSS transition
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

/**
 * Show/hide a loading overlay with an optional message.
 * @param {boolean} visible
 * @param {string} message
 */
export function setLoading(visible, message = 'Loading…') {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = `<div class="loading-box"><div class="loading-spinner"></div><div id="loadingMsg" class="loading-msg"></div></div>`;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('#loadingMsg').textContent = message;
  overlay.classList.toggle('hidden', !visible);
}

/**
 * Update the message inside an existing loading overlay without toggling it.
 */
export function setLoadingMessage(message) {
  const msg = document.getElementById('loadingMsg');
  if (msg) msg.textContent = message;
}
