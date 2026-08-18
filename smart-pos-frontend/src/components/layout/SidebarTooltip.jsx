import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Rail-collapsed icon labels only — not a general-purpose tooltip primitive.
// Portaled to document.body and positioned via getBoundingClientRect(),
// rather than an absolutely-positioned flyout inside the nav: the sidebar's
// <nav> scrolls (overflow-y-auto) and its <aside> wrapper carries a
// `transform` class for the mobile slide animation, which would make it the
// containing block for any position:fixed descendant and throw off
// viewport-relative coordinates. Portaling to <body> sidesteps both.
const SidebarTooltip = ({ anchorRef, label, visible }) => {
  const [coords, setCoords] = useState(null);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) {
      setCoords(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    setCoords({ top: rect.top + rect.height / 2, left: rect.right + 8 });
  }, [visible, anchorRef]);

  if (!visible || !coords) return null;

  return createPortal(
    <div
      role="tooltip"
      style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translateY(-50%)' }}
      className="z-[60] px-2 py-1 rounded bg-sidebar-bg border border-sidebar-border text-sidebar-text text-xs font-medium whitespace-nowrap shadow-lg pointer-events-none"
    >
      {label}
    </div>,
    document.body
  );
};

export default SidebarTooltip;
