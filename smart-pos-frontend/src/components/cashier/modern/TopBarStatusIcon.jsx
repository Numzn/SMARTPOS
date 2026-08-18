import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const STATE_CLASSES = {
  ok: 'text-emerald-600',
  warning: 'text-amber-600',
  offline: 'text-red-600',
  neutral: 'text-gray-400',
};

// Icon-only device/system status for the Cashier top bar — the icon color
// is the indicator, a hover tooltip (portaled to <body>, positioned via
// getBoundingClientRect so it isn't clipped by anything) carries the
// explanation. No permanent "Label: value" text in the normal interface.
const TopBarStatusIcon = ({ icon: Icon, state = 'neutral', label, detail }) => {
  const anchorRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState(null);

  useLayoutEffect(() => {
    if (!hovered || !anchorRef.current) {
      setCoords(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    // The rightmost icon in the row sits close to the viewport edge — a
    // tooltip centered under it would clip off-screen. Anchor to the
    // icon's right edge instead once there isn't enough room to center.
    const nearRightEdge = window.innerWidth - centerX < 90;
    setCoords({
      top: rect.bottom + 8,
      left: nearRightEdge ? rect.right : centerX,
      align: nearRightEdge ? 'right' : 'center',
    });
  }, [hovered]);

  return (
    <div
      ref={anchorRef}
      className="flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Icon className={`w-4 h-4 ${STATE_CLASSES[state] || STATE_CLASSES.neutral}`} strokeWidth={1.75} />
      {hovered &&
        coords &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              transform: coords.align === 'right' ? 'translateX(-100%)' : 'translateX(-50%)',
            }}
            className="z-[60] px-2.5 py-1.5 rounded bg-gray-900 text-white text-xs shadow-lg pointer-events-none whitespace-nowrap"
          >
            <div className="font-medium">{label}</div>
            {detail && <div className="text-gray-300 mt-0.5">{detail}</div>}
          </div>,
          document.body
        )}
    </div>
  );
};

export default TopBarStatusIcon;
