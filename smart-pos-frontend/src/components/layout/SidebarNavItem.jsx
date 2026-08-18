import { useRef, useState } from 'react';
import SidebarTooltip from './SidebarTooltip';

const SidebarNavItem = ({ icon: Icon, label, active, collapsed, onClick }) => {
  const anchorRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      ref={anchorRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={`${active ? 'nav-item-active' : 'nav-item'} ${collapsed ? 'justify-center px-0' : ''}`}
        aria-label={collapsed ? label : undefined}
      >
        <Icon className="w-4 h-4 shrink-0 opacity-80" strokeWidth={1.75} />
        {!collapsed && <span>{label}</span>}
      </button>
      {collapsed && <SidebarTooltip anchorRef={anchorRef} label={label} visible={hovered} />}
    </div>
  );
};

export default SidebarNavItem;
