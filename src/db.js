/**
 * db.js — IndexedDB wrapper for Alok Reader
 *
 * All persistence goes through this module. The rest of the app
 * never touches IndexedDB directly.
 */

const DB_NAME = 'alok-reader-v2';
const STORE   = 'books';
let db = null;

/** Open (or upgrade) the database. Must be called once at startup. */
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      db = req.result;
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Return all book records. */
export function getAllBooks() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

/** Insert or update a book record. */
export function putBook(book) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(book);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

/** Delete a book record by id. */
export function deleteBook(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}
