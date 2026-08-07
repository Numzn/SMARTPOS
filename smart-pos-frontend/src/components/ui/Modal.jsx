import React, { useEffect, useRef, useId } from 'react';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog primitive.
 *
 * The app previously had 13 hand-rolled modals, none of which announced
 * themselves as dialogs, trapped focus, or closed on Escape — so a keyboard or
 * screen-reader user could tab straight out of an open modal into the page
 * behind it with no way back and no way to dismiss.
 *
 * Provides:
 *  - role="dialog" + aria-modal so assistive tech announces it as a dialog
 *  - aria-labelledby pointing at the real title element
 *  - Escape to close
 *  - focus moved in on open, cycled inside while open, and restored to the
 *    element that opened it on close
 *  - a backdrop click target that is a real button, not a bare div
 *
 * `onClose` is optional: pass nothing for a modal that must be dismissed via
 * its own actions (a destructive confirm, say), and Escape/backdrop become
 * inert rather than silently doing nothing surprising.
 */
const Modal = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  initialFocusRef,
}) => {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;

    // Move focus into the dialog: caller's choice first, else the first
    // focusable element, else the panel itself so Escape still reaches us.
    const focusTarget =
      initialFocusRef?.current ||
      panelRef.current?.querySelector(FOCUSABLE) ||
      panelRef.current;
    focusTarget?.focus?.();

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      // Wrap at both ends so focus can never escape the dialog.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    // Stop the page behind the dialog scrolling under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose, initialFocusRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {onClose ? (
        <button
          type="button"
          aria-label="Close dialog"
          tabIndex={-1}
          onClick={onClose}
          className="absolute inset-0 bg-black bg-opacity-50 cursor-default"
        />
      ) : (
        <div className="absolute inset-0 bg-black bg-opacity-50" />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative bg-white rounded-lg shadow-xl w-full ${SIZES[size] || SIZES.md} max-h-[90vh] overflow-y-auto focus:outline-none`}
      >
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div>
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-gray-900">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="text-sm text-gray-500 mt-1">
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
              >
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
        )}

        <div className="px-6 py-4">{children}</div>

        {footer && <div className="px-6 pb-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;
