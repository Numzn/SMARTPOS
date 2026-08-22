import { useEffect, useRef } from 'react';

/**
 * Scanner driver — USB HID keyboard-wedge mode. This is the universal,
 * zero-driver tier every commercial barcode scanner ships in by default: it
 * types characters at machine speed, terminated by Enter/Tab, indistinguishable
 * from a keyboard to the OS. No WebHID/WebSerial permission dance, works in
 * any browser, kiosk or not.
 *
 * A fast, Enter-terminated burst is treated as a scan; anything slower (or
 * not terminated) is left alone so normal typing — the product search box,
 * quantity fields, login forms — is completely unaffected. This is a timing
 * heuristic, not a device API: the one honest limitation is that a scan's
 * characters may transiently reach a focused text field before the
 * terminator confirms it as a scan (only the terminator's default action is
 * suppressed). Harmless in practice — the fields on this screen only filter
 * or edit quantities, nothing destructive fires on stray text.
 */
const IDLE_RESET_MS = 500;
const FAST_AVG_MS_PER_CHAR = 30;
const MIN_LENGTH = 4;
const MAX_BUFFER = 64;

export function useBarcodeScanner(onBarcode, { enabled = true } = {}) {
  const onBarcodeRef = useRef(onBarcode);
  onBarcodeRef.current = onBarcode;

  const bufferRef = useRef('');
  const firstKeyAtRef = useRef(0);
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const reset = () => {
      bufferRef.current = '';
      firstKeyAtRef.current = 0;
      lastKeyAtRef.current = 0;
    };

    const handleKeyDown = (e) => {
      const now = performance.now();
      if (lastKeyAtRef.current && now - lastKeyAtRef.current > IDLE_RESET_MS) {
        reset();
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        const candidate = bufferRef.current;
        const elapsed = lastKeyAtRef.current - firstKeyAtRef.current;
        const avgPerChar = candidate.length > 0 ? elapsed / candidate.length : Infinity;
        reset();
        if (candidate.length >= MIN_LENGTH && avgPerChar <= FAST_AVG_MS_PER_CHAR) {
          e.preventDefault();
          onBarcodeRef.current(candidate);
        }
        return;
      }

      if (e.key.length !== 1) return; // ignore Shift/Ctrl/Alt/arrows/etc.

      if (bufferRef.current.length === 0) firstKeyAtRef.current = now;
      lastKeyAtRef.current = now;
      bufferRef.current += e.key;
      if (bufferRef.current.length > MAX_BUFFER) reset(); // defensive: never grow unbounded
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled]);
}
