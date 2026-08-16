import React from 'react';

const money = (n) => `K${Number(n || 0).toFixed(2)}`;

/**
 * SHORT/OVER/BALANCED — the one place a variance's sign gets a human label
 * instead of just a signed number, used consistently across the pending
 * queue, the reconcile compare, and shift history.
 */
const VarianceBadge = ({ variance, showAmount = true }) => {
  if (variance == null) return null;
  const rounded = Number(variance.toFixed(2));

  const { label, classes } =
    rounded === 0
      ? { label: 'BALANCED', classes: 'bg-emerald-100 text-emerald-800' }
      : rounded > 0
        ? { label: 'OVER', classes: 'bg-blue-100 text-blue-800' }
        : { label: 'SHORT', classes: 'bg-red-100 text-red-800' };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${classes}`}>
      {label}
      {showAmount && rounded !== 0 && <span className="font-normal">{money(Math.abs(rounded))}</span>}
    </span>
  );
};

export default VarianceBadge;
