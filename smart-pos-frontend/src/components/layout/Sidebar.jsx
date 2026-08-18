import { useState } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import SidebarNavItem from './SidebarNavItem';
import SidebarSection from './SidebarSection';
import SidebarStatus from './SidebarStatus';
import SidebarUserMenu from './SidebarUserMenu';

const RAIL_KEY = 'sidebar:collapsed';
const SECTIONS_KEY = 'sidebar:expandedSections';

function readRailCollapsed() {
  try {
    return localStorage.getItem(RAIL_KEY) === 'true';
  } catch {
    return false;
  }
}

function readExpandedSections() {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

// A stable top-level component, not one defined inside MainLayout's render
// body — a component declared per-render gets a new identity every time, so
// React would unmount and remount the entire sidebar DOM subtree on every
// MainLayout re-render (every route change, every header-search keystroke)
// instead of diffing it like a normal element. Living in its own module
// makes that mistake structurally impossible, not just commented-against.
const Sidebar = ({ dashboardItem, sections, activePath, onNavigate, onClose, zraStatus, user, onLogout }) => {
  const [railCollapsedPref, setRailCollapsedPref] = useState(readRailCollapsed);
  // A section id absent from this map means expanded, not collapsed — see
  // its use below. Storing only explicit overrides (rather than a snapshot
  // of every current section id) means a section that wasn't in `sections`
  // yet at mount (e.g. while permissions/user are still loading async) or
  // one added in a future release both correctly default to expanded,
  // instead of being locked in as collapsed by a one-time initializer.
  const [expandedSections, setExpandedSections] = useState(readExpandedSections);
  // The rail-collapse preference only ever applies on desktop — a 68px
  // icon-only rail is unusable as a mobile drawer, so below `lg` we always
  // render the full expanded structure regardless of what's persisted.
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const collapsed = railCollapsedPref && isDesktop;

  const toggleRail = () => {
    setRailCollapsedPref((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_KEY, String(next));
      } catch {
        // localStorage unavailable (private mode, quota) — it just won't persist.
      }
      return next;
    });
  };

  const toggleSection = (id) => {
    setExpandedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // localStorage unavailable — it just won't persist.
      }
      return next;
    });
  };

  return (
    <div
      className={`flex flex-col h-full w-72 bg-sidebar-bg text-sidebar-text-muted ${
        railCollapsedPref ? 'lg:w-[68px]' : 'lg:w-[260px]'
      }`}
    >
      <div className="h-12 flex items-center justify-between px-4 border-b border-sidebar-border shrink-0">
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-sidebar-text tracking-tight truncate">Smart POS</div>
            <div className="text-[10px] text-sidebar-text-section uppercase tracking-widest">Terminal</div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleRail}
          className="hidden lg:flex p-1 text-sidebar-text-muted hover:text-sidebar-text transition-colors"
          aria-label={railCollapsedPref ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={`w-4 h-4 transition-transform ${railCollapsedPref ? 'rotate-180' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="lg:hidden p-1 text-sidebar-text-muted hover:text-sidebar-text"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-3 overflow-y-auto sidebar-scroll">
        {dashboardItem && (
          <SidebarNavItem
            icon={dashboardItem.icon}
            label={dashboardItem.name}
            active={activePath === dashboardItem.href}
            collapsed={collapsed}
            onClick={() => onNavigate(dashboardItem.href)}
          />
        )}

        {sections.map((section) => (
          <SidebarSection
            key={section.id}
            id={section.id}
            label={section.label}
            items={section.items}
            activePath={activePath}
            collapsed={collapsed}
            expanded={expandedSections[section.id] !== false}
            onToggleExpand={toggleSection}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-2 space-y-1 shrink-0">
        <SidebarStatus status={zraStatus} collapsed={collapsed} />
        <SidebarUserMenu user={user} onLogout={onLogout} collapsed={collapsed} />
      </div>
    </div>
  );
};

export default Sidebar;
