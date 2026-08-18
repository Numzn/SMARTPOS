const STATUS_STYLES = {
  connected: { dot: 'bg-emerald-500', label: 'Connected' },
  'not initialized': { dot: 'bg-amber-500', label: 'Not initialized' },
  offline: { dot: 'bg-red-500', label: 'Offline' },
  'status unavailable': { dot: 'bg-sidebar-text-section', label: 'Unavailable' },
  checking: { dot: 'bg-sidebar-text-section animate-pulse', label: 'Checking…' },
};

// Reuses the app's existing .status-dot/.status-pill primitives (see
// StatusBar.jsx on the Cashier screen) but supplies dark-appropriate colors
// at the call site — StatusBar's light-mode combo would be near-invisible
// on the sidebar's graphite background.
const SidebarStatus = ({ status, collapsed }) => {
  const style = STATUS_STYLES[status] || STATUS_STYLES.checking;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1.5" title={`ZRA VSDC: ${style.label}`}>
        <span className={`status-dot ${style.dot}`} />
      </div>
    );
  }

  return (
    <div className="status-pill w-full justify-start border-sidebar-border bg-white/[0.03] px-2.5 py-1.5">
      <span className={`status-dot ${style.dot}`} />
      <span className="text-sidebar-text-muted">ZRA VSDC</span>
      <span className="ml-auto text-[11px] text-sidebar-text-section">{style.label}</span>
    </div>
  );
};

export default SidebarStatus;
