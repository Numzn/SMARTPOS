import { useCallback, useEffect, useRef, useState } from 'react';
import * as scanJournal from '../lib/scanJournal';
import { buildBarcodeIndex, normalizeBarcode } from '../lib/barcodeIndex';
import { foldScanEntriesToCart, unresolvedEntries } from '../lib/scanReducer';

/**
 * The scan pipeline — durable, ordered, optimistic. This is where the four
 * layers meet: it owns UI-facing cart state (derived, never mutated
 * directly), writes Local Transaction State (the durable journal) before
 * anything else happens, and hands off to Server Transaction State
 * (the existing till-lock session) only in the background via `syncScan`.
 *
 * Ordering proof: `ingest()` chains every call onto one promise (`queueRef`)
 * — a single consumer, never parallel — so scan N+1 can never be folded into
 * cart state before scan N has reached a terminal per-scan outcome
 * (resolved or lookup-failed). Durability proof: the journal write inside
 * processOne happens before cart state is touched at all, so "the cashier
 * saw it" implies "it survived a crash," never the reverse.
 *
 * Deliberately local-transaction-scoped, not server-session-scoped: the
 * journal is keyed on a client-generated `localTxnId`, generated the moment
 * the first scan of a fresh cart happens — entirely offline, no network
 * call. The *real* till-lock session (server-authoritative, tamper-checked
 * at checkout) is only ever touched from `syncScan`, in the background —
 * durability must never wait on it existing yet.
 */
export function useScanPipeline({ products, usingMockData, syncScan, onLocalTxnIdChange }) {
  const [cart, setCart] = useState([]);
  const [unresolved, setUnresolved] = useState([]);

  const localTxnIdRef = useRef(null);
  const entriesRef = useRef([]);
  const sequenceRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const syncQueueRef = useRef([]);
  const pumpingRef = useRef(false);
  const productsByIdRef = useRef(new Map());
  const barcodeIndexRef = useRef(new Map());
  const syncScanRef = useRef(syncScan);
  syncScanRef.current = syncScan;
  const usingMockDataRef = useRef(usingMockData);
  usingMockDataRef.current = usingMockData;

  const refold = useCallback(() => {
    setCart(foldScanEntriesToCart(entriesRef.current, productsByIdRef.current));
    setUnresolved(unresolvedEntries(entriesRef.current));
  }, []);

  // Refold on every catalog update, not just on a new scan — otherwise
  // recovery (§4) racing ahead of the initial product fetch would fold
  // against an empty index and silently show zero items until the next
  // scan happened to trigger a refold. This also keeps cart line data (e.g.
  // stock figures) current whenever the periodic silent refresh runs.
  useEffect(() => {
    productsByIdRef.current = new Map((products || []).map((p) => [p.id, p]));
    barcodeIndexRef.current = buildBarcodeIndex(products);
    refold();
  }, [products, refold]);

  const replaceEntry = useCallback(
    (updated) => {
      if (!updated) return;
      entriesRef.current = entriesRef.current.map((e) => (e.scanId === updated.scanId ? updated : e));
      refold();
    },
    [refold]
  );

  const ensureLocalTxnId = useCallback(() => {
    if (!localTxnIdRef.current) {
      localTxnIdRef.current = scanJournal.generateScanId();
      onLocalTxnIdChange?.(localTxnIdRef.current);
    }
    return localTxnIdRef.current;
  }, [onLocalTxnIdChange]);

  const backoffMsFor = (attempt) => Math.min(1000 * 2 ** attempt, 15000);

  const pumpSync = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (syncQueueRef.current.length > 0) {
        const scanId = syncQueueRef.current[0];
        const entry = entriesRef.current.find((e) => e.scanId === scanId);
        if (!entry || entry.status === 'SYNCED' || entry.status === 'SYNC_REJECTED') {
          syncQueueRef.current.shift();
          continue;
        }
        const marked = await scanJournal.updateScan(scanId, { status: 'SYNCING' });
        replaceEntry(marked);
        try {
          await syncScanRef.current(entry);
          const synced = await scanJournal.updateScan(scanId, { status: 'SYNCED' });
          replaceEntry(synced);
          syncQueueRef.current.shift();
        } catch (err) {
          // A business rejection (stock gone, product deregistered, etc.) is
          // a terminal answer — never retried with backoff like a transient
          // network/5xx error. Surfaced via `unresolved` for the cashier to
          // act on before checkout, not discovered as a checkout-time error.
          const isBusinessRejection = err?.status >= 400 && err.status < 500;
          if (isBusinessRejection) {
            const rejected = await scanJournal.updateScan(scanId, {
              status: 'SYNC_REJECTED',
              syncError: err.message,
            });
            replaceEntry(rejected);
            syncQueueRef.current.shift();
          } else {
            const attempt = (entry.syncAttempts || 0) + 1;
            const retried = await scanJournal.updateScan(scanId, { status: 'RESOLVED', syncAttempts: attempt });
            replaceEntry(retried);
            await new Promise((resolve) => setTimeout(resolve, backoffMsFor(attempt)));
          }
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [replaceEntry]);

  const enqueueSync = useCallback(
    (entry) => {
      if (usingMockDataRef.current) return; // demo mode never touches the server
      syncQueueRef.current.push(entry.scanId);
      pumpSync();
    },
    [pumpSync]
  );

  const processOne = useCallback(
    async (rawInput) => {
      const scanId = scanJournal.generateScanId();
      const sequence = sequenceRef.current++;

      if (usingMockDataRef.current) {
        // Demo/dev fallback (backend unreachable at load) — same fold shape,
        // no durable journal and no server sync, matching the pre-existing
        // mock-data behavior this pipeline slots underneath.
        const product = rawInput.product || barcodeIndexRef.current.get(normalizeBarcode(rawInput.rawToken)) || null;
        entriesRef.current = [
          ...entriesRef.current,
          {
            scanId,
            sequence,
            productId: product?.id ?? null,
            status: product ? 'RESOLVED' : 'LOOKUP_FAILED',
          },
        ];
        refold();
        return;
      }

      const localTxnId = ensureLocalTxnId();
      const journalEntry = {
        scanId,
        localTxnId,
        sequence,
        rawToken: rawInput.rawToken,
        barcode: null,
        productId: rawInput.product?.id ?? null,
        unitPrice: rawInput.product?.price ?? null,
        status: 'CAPTURED',
        createdAt: Date.now(),
      };
      // Durable write BEFORE anything else — this line is what "accepted"
      // means. Cart state below only ever reflects entries that reached
      // this point already.
      await scanJournal.appendScan(journalEntry);
      entriesRef.current = [...entriesRef.current, journalEntry];

      let product = rawInput.product || null;
      const barcode = product ? String(product.barcode || product.sku || product.id) : normalizeBarcode(rawInput.rawToken);
      if (!product) product = barcodeIndexRef.current.get(barcode) || null;

      const patch = product
        ? { barcode, productId: product.id, unitPrice: product.price, status: 'RESOLVED' }
        : { barcode, status: 'LOOKUP_FAILED' };
      const updated = await scanJournal.updateScan(scanId, patch);
      entriesRef.current = entriesRef.current.map((e) => (e.scanId === scanId ? updated : e));
      refold();

      if (product) enqueueSync(updated);
    },
    [enqueueSync, ensureLocalTxnId, refold]
  );

  // Single-consumer serialization: every ingest chains onto the same promise,
  // so two scans can never be mid-processing at once — the entire mechanism
  // that proves ordering survives a rapid-fire burst.
  const ingest = useCallback(
    (rawInput) => {
      queueRef.current = queueRef.current.then(() => processOne(rawInput)).catch((err) => {
        console.error('Scan pipeline error:', err);
      });
      return queueRef.current;
    },
    [processOne]
  );

  const ingestProduct = useCallback(
    (product) => ingest({ rawToken: product.barcode || product.sku || product.id, product }),
    [ingest]
  );
  const ingestBarcode = useCallback((raw) => ingest({ rawToken: raw, product: null }), [ingest]);

  /** Recovery: reload a persisted localTxnId's journal and resume sync. */
  const recoverTransaction = useCallback(
    async (existingLocalTxnId) => {
      if (!existingLocalTxnId) return;
      localTxnIdRef.current = existingLocalTxnId;
      const entries = await scanJournal.getEntriesForSession(existingLocalTxnId);
      if (entries.length === 0) return;
      // Tell the parent this id is live *now* — otherwise its own persisted-
      // localTxnId effect (state still null at this point) would immediately
      // remove the very localStorage entry recovery just read, and a second
      // reload would find nothing. Caught by live-testing this against a
      // real deploy, not by code review alone.
      onLocalTxnIdChange?.(existingLocalTxnId);
      entriesRef.current = entries;
      sequenceRef.current = entries.reduce((max, e) => Math.max(max, e.sequence), -1) + 1;
      refold();
      // Resume sync for anything not yet confirmed. Safe even if the server
      // already actually had it — clientScanId idempotency (lib/tillLock.js)
      // makes a redundant replay a no-op, never a double-increment.
      for (const entry of entries) {
        if (entry.status === 'RESOLVED' || entry.status === 'SYNCING') {
          syncQueueRef.current.push(entry.scanId);
        }
      }
      pumpSync();
    },
    [pumpSync, refold, onLocalTxnIdChange]
  );

  /**
   * Reconciles the local fold with an already-server-approved reversal
   * (lib/tillLock.js's reverseLine, gated on a supervisor ticket — that flow
   * is untouched by this redesign, only its *local* aftermath is new). Marks
   * the most-recently-scanned entries for this product REVERSED — a status
   * the fold already excludes — until the remaining count matches
   * toQuantity. Applied to in-memory state immediately (the server call
   * already completed by the time this runs); the matching durable journal
   * update is fire-and-forget hygiene, not a correctness requirement.
   */
  const applyReversal = useCallback(
    (productId, toQuantity) => {
      const active = entriesRef.current
        .filter((e) => e.productId === productId && ['RESOLVED', 'SYNCING', 'SYNCED'].includes(e.status))
        .sort((a, b) => b.sequence - a.sequence);
      const reverseCount = Math.max(0, active.length - toQuantity);
      const reversedIds = new Set(active.slice(0, reverseCount).map((e) => e.scanId));
      if (reversedIds.size === 0) return;

      entriesRef.current = entriesRef.current.map((e) =>
        reversedIds.has(e.scanId) ? { ...e, status: 'REVERSED' } : e
      );
      refold();
      reversedIds.forEach((scanId) => {
        scanJournal.updateScan(scanId, { status: 'REVERSED' }).catch(() => {});
      });
    },
    [refold]
  );

  const clearTransaction = useCallback(async () => {
    const id = localTxnIdRef.current;
    localTxnIdRef.current = null;
    entriesRef.current = [];
    sequenceRef.current = 0;
    syncQueueRef.current = [];
    setCart([]);
    setUnresolved([]);
    onLocalTxnIdChange?.(null);
    if (id) {
      try {
        await scanJournal.clearSession(id);
      } catch {
        // Hygiene only — a leftover journal row for a consumed/abandoned
        // transaction is harmless, never re-read once its localTxnId is gone.
      }
    }
  }, [onLocalTxnIdChange]);

  return { cart, unresolved, ingestProduct, ingestBarcode, recoverTransaction, applyReversal, clearTransaction };
}
