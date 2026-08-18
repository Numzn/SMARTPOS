import { useState } from 'react';
import { LogOut } from 'lucide-react';

function initialsFor(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Content is a straight relocation of the old header profile dropdown
// (name/email/role + Sign Out) — no new menu entries. No route or feature
// exists yet for a profile page, terminal management, or shortcuts, so
// those stay out per the same "don't build nav for what isn't there"
// standard applied to the rest of the sidebar.
const SidebarUserMenu = ({ user, onLogout, collapsed }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-sidebar-hover transition-colors ${collapsed ? 'justify-center px-0' : ''}`}
        aria-label={collapsed ? `${user?.name} — ${user?.role}` : undefined}
      >
        <span className="w-6 h-6 shrink-0 rounded-full bg-white/10 text-sidebar-text text-[11px] font-semibold flex items-center justify-center">
          {initialsFor(user?.name)}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-sidebar-text truncate">{user?.name}</span>
            <span className="block text-[10px] text-sidebar-text-section uppercase tracking-wide truncate">{user?.role}</span>
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute bottom-full mb-1 panel bg-sidebar-bg border-sidebar-border py-1 z-50 ${collapsed ? 'left-full ml-2 w-52' : 'left-0 right-0'}`}>
          <div className="px-3 py-2 border-b border-sidebar-border">
            <p className="text-sm font-medium text-sidebar-text truncate">{user?.name}</p>
            <p className="text-xs text-sidebar-text-muted truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-sidebar-text-muted hover:bg-sidebar-hover hover:text-sidebar-text transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default SidebarUserMenu;
