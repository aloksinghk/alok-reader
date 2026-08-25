/**
 * covers.js — Intelligent title/author parser and online book cover image fetcher
 *
 * Features:
 *  - Sanitizes raw filenames into clean book titles and detected authors.
 *  - Fetches book cover images from Open Library & Google Books APIs.
 *  - Converts fetched images into Base64 Data URLs for offline persistence in IndexedDB.
 *  - Timeout-safe (3.5s) to guarantee fast imports even on slow connections.
 */

/**
 * Clean raw filenames and metadata into polished title and author strings.
 * @param {string} filename
 * @param {string} metaTitle
 * @param {string} metaAuthor
 * @param {string} [firstPageText]
 * @returns {{ title: string, author: string }}
 */
export function cleanTitleAndAuthor(filename = '', metaTitle = '', metaAuthor = '', firstPageText = '') {
  let title = (metaTitle || '').trim();
  let author = (metaAuthor || '').trim();

  // If title is missing, empty, or looks like a raw filename/path, derive from filename
  const isFilenameLike = !title || title.toLowerCase().endsWith('.pdf') || title.includes('/') || title.includes('\\') || /^[A-Za-z0-9_-]{10,}$/.test(title);

  if (isFilenameLike) {
    let clean = filename
      .replace(/\.pdf$/i, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\[(?:PDF|EPUB|Book|z-lib(?:\.org)?|audiobook)[^\]]*\]/gi, '')
      .replace(/\((?:z-lib(?:\.org)?|19\d\d|20\d\d|v\d+)[^)]*\)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Check for "Author - Title" or "Author — Title"
    if (clean.includes(' - ') || clean.includes(' — ')) {
      const parts = clean.split(/\s*[-—]\s*/);
      if (parts.length >= 2) {
        if (!author) author = parts[0].trim();
        clean = parts.slice(1).join(' - ').trim();
      }
    } else if (/\s+by\s+/i.test(clean)) {
      const parts = clean.split(/\s+by\s+/i);
      clean = parts[0].trim();
      if (!author) author = parts[1].trim();
    }

    title = clean;
  }

  // Capitalize title nicely if it's all lowercase
  if (title && title === title.toLowerCase()) {
    title = title.replace(/\b\w/g, c => c.toUpperCase());
  }

  // If author is still empty, attempt to discover "By [Author]" from first page text
  if (!author && firstPageText) {
    const lines = firstPageText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 15);
    for (const line of lines) {
      const byMatch = line.match(/^by\s+([A-Z][A-Za-z.\s'’-]{2,50})/i);
      if (byMatch && !/^(chapter|part|section|the|an|a|copyright|all\s+rights)/i.test(byMatch[1].trim())) {
        author = byMatch[1].trim();
        break;
      }
      const authorMatch = line.match(/^author[:\s]+([A-Z][A-Za-z.\s'’-]{2,50})/i);
      if (authorMatch) {
        author = authorMatch[1].trim();
        break;
      }
    }
  }

  // Fallback title formatting
  if (!title) {
    title = filename.replace(/\.pdf$/i, '').replace(/[_\-]+/g, ' ') || 'Untitled Book';
  }

  return { title, author };
}

/**
 * Fetch an image URL and convert it into a base64 data URL for offline storage.
 * @param {string} url
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<string|null>}
 */
async function urlToDataUrl(url, timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size < 500) return null;

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    // Return original url if blob conversion fails, or null
    return url.startsWith('http') ? url : null;
  }
}

/**
 * Query Open Library for book cover and metadata.
 * @param {string} query
 * @param {AbortSignal} signal
 * @returns {Promise<{ coverUrl: string|null, author: string|null }>}
 */
async function searchOpenLibrary(query, signal) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, { signal });
    if (!res.ok) return { coverUrl: null, author: null };

    const data = await res.json();
    const doc = data.docs?.[0];
    if (!doc) return { coverUrl: null, author: null };

    let coverUrl = null;
    if (doc.cover_i) {
      coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
    } else if (doc.isbn && doc.isbn[0]) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-M.jpg`;
    }

    const author = doc.author_name?.[0] || null;
    return { coverUrl, author };
  } catch {
    return { coverUrl: null, author: null };
  }
}

/**
 * Query Google Books for book cover and metadata.
 * @param {string} query
 * @param {AbortSignal} signal
 * @returns {Promise<{ coverUrl: string|null, author: string|null }>}
 */
async function searchGoogleBooks(query, signal) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
    const res = await fetch(url, { signal });
    if (!res.ok) return { coverUrl: null, author: null };

    const data = await res.json();
    const item = data.items?.[0]?.volumeInfo;
    if (!item) return { coverUrl: null, author: null };

    let coverUrl = item.imageLinks?.thumbnail || item.imageLinks?.smallThumbnail || null;
    if (coverUrl && coverUrl.startsWith('http:')) {
      coverUrl = coverUrl.replace(/^http:/, 'https:');
    }

    const author = item.authors?.[0] || null;
    return { coverUrl, author };
  } catch {
    return { coverUrl: null, author: null };
  }
}

/**
 * Search the internet for a book cover image.
 * Uses Open Library and Google Books in parallel with a 3.5s timeout.
 * @param {string} title
 * @param {string} [author='']
 * @returns {Promise<{ coverImage: string|null, author: string }>}
 */
export async function fetchBookCover(title, author = '') {
  // If user is offline, return immediately without network overhead
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { coverImage: null, author };
  }

  if (!title || title.length < 2) {
    return { coverImage: null, author };
  }

  const query = author ? `${title} ${author}` : title;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    // Query both services in parallel for maximum hit rate and speed
    const [olResult, gbResult] = await Promise.all([
      searchOpenLibrary(query, controller.signal).catch(() => ({ coverUrl: null, author: null })),
      searchGoogleBooks(query, controller.signal).catch(() => ({ coverUrl: null, author: null })),
    ]);

    clearTimeout(timer);

    const bestCoverUrl = olResult.coverUrl || gbResult.coverUrl;
    const resolvedAuthor = author || olResult.author || gbResult.author || '';

    if (!bestCoverUrl) {
      return { coverImage: null, author: resolvedAuthor };
    }

    // Convert to Base64 for permanent offline caching
    const dataUrl = await urlToDataUrl(bestCoverUrl, 2500);
    return {
      coverImage: dataUrl || bestCoverUrl,
      author: resolvedAuthor,
    };
  } catch {
    return { coverImage: null, author };
  }
}
