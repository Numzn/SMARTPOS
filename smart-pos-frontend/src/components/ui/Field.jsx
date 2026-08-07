import React, { useId } from 'react';

/**
 * Form field primitives.
 *
 * The app had 62 <label> elements but only 2 htmlFor attributes, so almost
 * every label was visually adjacent to its input while being programmatically
 * unconnected — a screen reader announced "edit text, blank" with no clue what
 * the field was for. Generating the id here means association can't be
 * forgotten at a call site.
 *
 * Each control also wires:
 *  - aria-invalid when there's an error, so the failure is announced
 *  - aria-describedby pointing at the error/hint text
 *  - aria-required, since the visual "*" alone conveys nothing non-visually
 */

const baseInput =
  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50';

function useFieldIds(error, hint) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return { id, errorId, hintId, describedBy };
}

const Wrapper = ({ id, label, required, error, hint, errorId, hintId, children, className }) => (
  <div className={className}>
    {label && (
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && (
          <>
            {' '}
            <span aria-hidden="true" className="text-red-500">*</span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </label>
    )}
    {children}
    {hint && !error && (
      <p id={hintId} className="text-xs text-gray-500 mt-1">
        {hint}
      </p>
    )}
    {error && (
      <p id={errorId} className="text-red-600 text-xs mt-1">
        {error}
      </p>
    )}
  </div>
);

export const TextField = ({
  label, value, onChange, error, hint, required, className, type = 'text', ...rest
}) => {
  const { id, errorId, hintId, describedBy } = useFieldIds(error, hint);
  return (
    <Wrapper {...{ id, label, required, error, hint, errorId, hintId, className }}>
      <input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        aria-required={required ? 'true' : undefined}
        className={`${baseInput} ${error ? 'border-red-500' : 'border-gray-300'}`}
        {...rest}
      />
    </Wrapper>
  );
};

export const TextAreaField = ({
  label, value, onChange, error, hint, required, className, rows = 2, ...rest
}) => {
  const { id, errorId, hintId, describedBy } = useFieldIds(error, hint);
  return (
    <Wrapper {...{ id, label, required, error, hint, errorId, hintId, className }}>
      <textarea
        id={id}
        rows={rows}
        value={value ?? ''}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        aria-required={required ? 'true' : undefined}
        className={`${baseInput} ${error ? 'border-red-500' : 'border-gray-300'}`}
        {...rest}
      />
    </Wrapper>
  );
};

export const SelectField = ({
  label, value, onChange, error, hint, required, className, children, ...rest
}) => {
  const { id, errorId, hintId, describedBy } = useFieldIds(error, hint);
  return (
    <Wrapper {...{ id, label, required, error, hint, errorId, hintId, className }}>
      <select
        id={id}
        value={value ?? ''}
        onChange={onChange}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        aria-required={required ? 'true' : undefined}
        className={`${baseInput} ${error ? 'border-red-500' : 'border-gray-300'}`}
        {...rest}
      >
        {children}
      </select>
    </Wrapper>
  );
};

/**
 * Polite live region for async status — "Saving…", "Export failed", a result
 * count after filtering. Without one, screen-reader users get no feedback that
 * anything happened after pressing a button.
 */
export const LiveStatus = ({ message, assertive = false }) => (
  <p
    role="status"
    aria-live={assertive ? 'assertive' : 'polite'}
    aria-atomic="true"
    className="sr-only"
  >
    {message || ''}
  </p>
);
