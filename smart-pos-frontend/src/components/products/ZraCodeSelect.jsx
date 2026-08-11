import React, { useEffect, useState } from 'react';

/**
 * Small, bounded ZRA code dropdown — Tax Type / Package Unit / Quantity Unit
 * (Section 5 UI layer, see smart-pos-backend/docs/zra-self-checklist.md item
 * 8*). Unlike ClassificationPicker (thousands of rows, server-side search),
 * these are short enumerable lists (~4-10 codes today), so a native <select>
 * loaded once is the right shape — it also makes "can't submit arbitrary
 * text" free: a native select only ever emits one of its own <option>s.
 *
 * `fetcher` is one of the zraCodesApi fetch functions; it's injected rather
 * than hardcoded so this one component serves all three fields.
 */
export default function ZraCodeSelect({
  id,
  label,
  value,
  onChange,
  fetcher,
  disabled = false,
  error = null,
  placeholder = 'Not set (ZRA registration will use a synced default)',
}) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetcher()
      .then((res) => {
        if (cancelled) return;
        setCodes(res?.codes || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err?.message || 'Failed to load ZRA codes');
        setCodes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The product's stored value may be a code that's no longer in the
  // current synced set (deprecated, or synced under old data before this
  // fix) — show it plainly instead of silently blanking the select.
  const hasCurrentValue = value && codes.some((c) => c.code === value);
  const staleValue = value && !hasCurrentValue && !loading;

  return (
    <div>
      <select
        id={id}
        value={value || ''}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value || null)}
        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
      >
        <option value="">{loading ? 'Loading…' : placeholder}</option>
        {staleValue && (
          <option value={value}>{value} (no longer synced — reselect)</option>
        )}
        {codes.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </select>
      {fetchError && (
        <p className="text-red-500 text-xs mt-1">
          {fetchError} — {label || 'this field'} options could not be loaded.
        </p>
      )}
      {!loading && !fetchError && codes.length === 0 && (
        <p className="text-sm text-gray-500 mt-1">
          No codes synced yet — sync ZRA codes in Settings first.
        </p>
      )}
    </div>
  );
}
