/**
 * Durable local scan journal — the "Local Transaction State" layer.
 *
 * One IndexedDB object store, keyed by scanId, foreign-keyed to the existing
 * server-side CashierCartSession (no new local transaction wrapper — the
 * session already is one). This is the only thing that has to survive a tab
 * crash/reload for the hot-path optimization to be safe: "accepted" means
 * "durably written here," not "the UI updated" and not "the server confirmed."
 *
 * Status lifecycle per entry:
 *   CAPTURED -> RESOLVED | LOOKUP_FAILED -> SYNCING -> SYNCED | SYNC_REJECTED
 *
 * Deliberately NOT a general offline database: it only needs to survive a
 * same-session crash/reload and hand back an ordered list to fold into cart
 * state. Multi-day outage tolerance and cross-device conflict handling are
 * out of scope here (H4), not this.
 */

const DB_NAME = 'smartpos-till';
const DB_VERSION = 2;
const STORE = 'scanEvents';

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this environment'));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1 had a broken index (built on a `sessionId` field the entries
      // never actually had — a leftover from an earlier naming pass before
      // the local-transaction-id/server-session-id split existed). Nothing
      // in that store is worth preserving across the fix; drop and recreate
      // rather than trying to migrate a schema that never worked.
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      // Indexed on localTxnId — the client-generated local transaction id
      // (see useScanPipeline.js), never the server till-lock session id.
      // The two are deliberately different things: this store must be
      // queryable before the server session even exists.
      const store = db.createObjectStore(STORE, { keyPath: 'scanId' });
      store.createIndex('byLocalTxn', 'localTxnId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('scanJournal transaction aborted'));
  });
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Durable write — this call completing IS the definition of "accepted." */
export async function appendScan(entry) {
  await withStore('readwrite', (store) => requestToPromise(store.add(entry)));
  return entry;
}

export async function updateScan(scanId, patch) {
  return withStore('readwrite', async (store) => {
    const existing = await requestToPromise(store.get(scanId));
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await requestToPromise(store.put(updated));
    return updated;
  });
}

export async function getEntriesForSession(localTxnId) {
  const entries = await withStore('readonly', (store) =>
    requestToPromise(store.index('byLocalTxn').getAll(localTxnId))
  );
  return entries.slice().sort((a, b) => a.sequence - b.sequence);
}

export async function nextSequence(localTxnId) {
  const entries = await getEntriesForSession(localTxnId);
  return entries.reduce((max, e) => Math.max(max, e.sequence), -1) + 1;
}

/** Called once a transaction is consumed/abandoned — hygiene, not correctness. */
export async function clearSession(localTxnId) {
  const entries = await getEntriesForSession(localTxnId);
  await withStore('readwrite', async (store) => {
    for (const entry of entries) {
      await requestToPromise(store.delete(entry.scanId));
    }
  });
}

export function generateScanId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for a non-secure-context/older environment — still unique
  // enough for a local idempotency key, just not cryptographically so.
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
