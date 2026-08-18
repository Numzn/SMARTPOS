import { ChevronDown } from 'lucide-react';
import SidebarNavItem from './SidebarNavItem';

// Rail-collapsed mode has no room for an accordion at 68px, so it always
// shows every item as a header-less icon stack regardless of the persisted
// expanded/collapsed flag — that flag only matters in full-width mode.
const SidebarSection = ({ id, label, items, activePath, collapsed, expanded, onToggleExpand, onNavigate }) => {
  // Defensive — the caller (MainLayout) is expected to have already dropped
  // empty sections, but a section with nothing to show should never render
  // a header of its own regardless.
  if (!items || items.length === 0) return null;

  if (collapsed) {
    return (
      <div className="space-y-0.5">
        {items.map((item) => (
          <SidebarNavItem
            key={item.name}
            icon={item.icon}
            label={item.name}
            active={activePath === item.href}
            collapsed
            onClick={() => onNavigate(item.href)}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleExpand(id)}
        className="w-full flex items-center justify-between px-3 py-1.5 nav-section-label hover:text-sidebar-text-muted transition-colors"
        aria-expanded={expanded}
      >
        <span>{label}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className="space-y-0.5">
          {items.map((item) => (
            <SidebarNavItem
              key={item.name}
              icon={item.icon}
              label={item.name}
              active={activePath === item.href}
              collapsed={false}
              onClick={() => onNavigate(item.href)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SidebarSection;
