import React, { useCallback, useEffect, useRef, useState } from 'react';
import { searchClassificationCodes } from '../../api/classificationApi';

const DEBOUNCE_MS = 300;
const PAGE_LIMIT = 20;

/**
 * Type-ahead selector for ZRA item classification codes (Section 5 UI layer —
 * see smart-pos-backend/docs/zra-self-checklist.md item 8*).
 *
 * Replaces the old free-text "ZRA Classification Code" input. Backed by
 * GET /api/items/classification-codes?q=&limit= — server-side search over the
 * synced ZraClassificationCode table, never the whole dataset. The stored
 * value only ever comes from clicking (or Enter-selecting) a result the
 * server actually returned, so arbitrary text can no longer reach a product.
 *
 * Deliberately flat, not a tree: the locally synced classification data has
 * no reliable, derived parent/child structure (mock/dev data is 3 rows with
 * no hierarchy-building logic anywhere in the codebase — see the item 8*
 * write-up for the full inspection). `value`/`onChange` only ever exchange a
 * bare itemClsCd string, so a hierarchical picker could replace this
 * component's internals later without touching ProductModal or the ZRA
 * payload builder.
 */
export default function ClassificationPicker({
  id,
  value,
  onChange,
  disabled = false,
  error = null,
  placeholder = 'Search classification by code or name…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selected, setSelected] = useState(null); // { code, name, stale? } | null
  const [resolvingSelected, setResolvingSelected] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);

  // Resolve a display label for a value set from outside (edit mode loading
  // an existing product, or a form reset). Reuses the same search endpoint
  // rather than adding a dedicated "get by code" route — an exact-code search
  // is just a search with one expected match.
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSelected(null);
      return undefined;
    }
    if (selected?.code === value) return undefined;

    setResolvingSelected(true);
    searchClassificationCodes(value, { limit: 5 })
      .then((res) => {
        if (cancelled) return;
        const match = (res?.codes || []).find((c) => c.code === value);
        // No match = the code was removed or deprecated since it was set on
        // this product. Show it plainly rather than silently dropping it —
        // the operator needs to know to pick a replacement.
        setSelected(match || { code: value, name: null, stale: true });
      })
      .catch(() => {
        if (!cancelled) setSelected({ code: value, name: null, stale: true });
      })
      .finally(() => {
        if (!cancelled) setResolvingSelected(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const runSearch = useCallback((term) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLoading(true);
    setFetchError(null);

    searchClassificationCodes(term, { limit: PAGE_LIMIT, signal: controller.signal })
      .then((res) => {
        if (requestId !== requestIdRef.current) return; // superseded by a newer search
        setResults(res?.codes || []);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        if (err?.name === 'AbortError') return;
        setFetchError(err?.message || 'Failed to search classification codes');
        setResults([]);
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    setHighlightIndex(-1);
    runSearch(query);
  };

  const handleQueryChange = (e) => {
    const term = e.target.value;
    setQuery(term);
    setOpen(true);
    setHighlightIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(term), DEBOUNCE_MS);
  };

  const selectItem = (item) => {
    setSelected(item);
    onChange?.(item.code, item);
    setQuery('');
    setOpen(false);
    setHighlightIndex(-1);
  };

  const clearSelection = () => {
    setSelected(null);
    onChange?.(null, null);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        handleOpen();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && results[highlightIndex]) {
        selectItem(results[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clean up any in-flight debounce/request on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    },
    []
  );

  const showSelectedChip = Boolean(selected) && !open;

  return (
    <div className="relative" ref={containerRef}>
      {showSelectedChip ? (
        <div
          className={`w-full px-3 py-2 border rounded-md flex items-center justify-between ${
            selected.stale ? 'border-amber-400 bg-amber-50' : 'border-gray-300 bg-gray-50'
          } ${disabled ? 'opacity-60' : ''}`}
        >
          <button
            type="button"
            className="text-left flex-1 min-w-0"
            onClick={handleOpen}
            disabled={disabled}
          >
            <span className="font-mono text-sm text-gray-700">{selected.code}</span>
            {selected.name && (
              <span className="ml-2 text-sm text-gray-900 truncate">{selected.name}</span>
            )}
            {selected.stale && (
              <span className="block text-xs text-amber-700 mt-0.5">
                No longer found in synced ZRA codes — pick a new classification.
              </span>
            )}
          </button>
          {!disabled && (
            <button
              type="button"
              onClick={clearSelection}
              className="ml-2 text-gray-400 hover:text-gray-600"
              aria-label="Clear classification"
            >
              ×
            </button>
          )}
        </div>
      ) : (
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          disabled={disabled || resolvingSelected}
          placeholder={resolvingSelected ? 'Loading…' : placeholder}
          onChange={handleQueryChange}
          onFocus={handleOpen}
          onKeyDown={handleKeyDown}
          className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
            error ? 'border-red-500' : 'border-gray-300'
          }`}
        />
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-auto">
          {loading && <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>}
          {!loading && fetchError && (
            <div className="px-3 py-2 text-sm text-red-600">{fetchError}</div>
          )}
          {!loading && !fetchError && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {query
                ? `No classification codes match "${query}"`
                : 'No classification codes available — sync codes in Settings first.'}
            </div>
          )}
          {!loading &&
            !fetchError &&
            results.map((item, index) => (
              <button
                type="button"
                key={item.code}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectItem(item)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                  index === highlightIndex ? 'bg-blue-50' : ''
                }`}
              >
                <span className="font-mono text-gray-700">{item.code}</span>
                <span className="ml-2 text-gray-900">{item.name}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
