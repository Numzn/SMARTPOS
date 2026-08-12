import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/apiClient';

const DEBOUNCE_MS = 300;

/**
 * Type-ahead product search, used to pick a composition component (see
 * ItemCompositionModal.jsx). Backed by the existing GET /api/products?q=
 * search — no new backend search endpoint needed for this.
 *
 * Transient selector, not a stored-value field like ClassificationPicker:
 * `onSelect` fires once per pick and the input clears, since the caller
 * (an "add component" mini-form) re-renders its own list of already-added
 * components rather than this component tracking a persisted value.
 */
export default function ProductPicker({ excludeProductId, onSelect, placeholder = 'Search products by name or SKU…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback(
    (term) => {
      if (!term) {
        setResults([]);
        setLoading(false);
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setFetchError(null);

      apiFetch(`/products?q=${encodeURIComponent(term)}&limit=20`)
        .then((res) => {
          if (requestId !== requestIdRef.current) return;
          const list = Array.isArray(res) ? res : [];
          setResults(list.filter((p) => p.id !== excludeProductId));
        })
        .catch((err) => {
          if (requestId !== requestIdRef.current) return;
          setFetchError(err?.message || 'Failed to search products');
          setResults([]);
        })
        .finally(() => {
          if (requestId !== requestIdRef.current) return;
          setLoading(false);
        });
    },
    [excludeProductId]
  );

  const handleQueryChange = (e) => {
    const term = e.target.value;
    setQuery(term);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(term), DEBOUNCE_MS);
  };

  const selectItem = (item) => {
    onSelect?.(item);
    setQuery('');
    setResults([]);
    setOpen(false);
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

  useEffect(() => () => debounceRef.current && clearTimeout(debounceRef.current), []);

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onChange={handleQueryChange}
        onFocus={() => query && setOpen(true)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-auto">
          {loading && <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>}
          {!loading && fetchError && <div className="px-3 py-2 text-sm text-red-600">{fetchError}</div>}
          {!loading && !fetchError && query && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No products match "{query}"</div>
          )}
          {!loading &&
            !fetchError &&
            results.map((item) => (
              <button
                type="button"
                key={item.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectItem(item)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
              >
                <span className="text-gray-900">{item.name}</span>
                {item.sku && <span className="ml-2 font-mono text-xs text-gray-500">{item.sku}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
