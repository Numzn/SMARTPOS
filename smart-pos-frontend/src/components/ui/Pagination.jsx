import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Offset/limit pagination footer. The first place in the app needing real
 * pagination controls — every other list page fetches its full dataset and
 * filters client-side, which doesn't scale to an audit trail.
 */
const Pagination = ({ offset, limit, totalCount, onPageChange }) => {
  const start = totalCount === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, totalCount);
  const canPrev = offset > 0;
  const canNext = offset + limit < totalCount;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border text-sm text-gray-600">
      <span>
        Showing {start}–{end} of {totalCount}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={!canPrev}
          className="btn btn-secondary !px-2.5 !py-1 !text-xs"
        >
          <ChevronLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(offset + limit)}
          disabled={!canNext}
          className="btn btn-secondary !px-2.5 !py-1 !text-xs"
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
