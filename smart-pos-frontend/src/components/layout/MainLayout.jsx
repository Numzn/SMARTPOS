import React, { Suspense, useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Menu, Search, Bell } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useZraStatus } from '../../hooks/useZraStatus';
import { DASHBOARD_ITEM, NAV_SECTIONS } from './navItems';
import Sidebar from './Sidebar';

// Scoped to just the routed page content — the previous boundary wrapped the
// whole MainLayout at the router level, so a lazy chunk that hadn't loaded
// yet (every back-office page on a fresh reload) blanked out the sidebar and
// header along with the content while it fetched.
const RouteFallback = () => (
  <div className="p-10 text-center text-gray-500" role="status" aria-live="polite">
    Loading…
  </div>
);

const MainLayout = () => {
  const { user, logout } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');
  // Polled once here (not per-route) so the sidebar footer has live status
  // everywhere, not just on /cashier — see useZraStatus.js.
  const zraStatus = useZraStatus({ enabled: permissions.canAccess.viewZRAStatus });

  const dashboardVisible = DASHBOARD_ITEM.show(permissions.canAccess, user);
  const visibleSections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.show(permissions.canAccess, user)),
    }))
    .filter((section) => section.items.length > 0);
  const isCashierRoute = location.pathname === '/cashier';

  useEffect(() => {
    setHeaderSearch('');
  }, [location.pathname]);

  const headerSearchPlaceholder =
    location.pathname === '/sales'
      ? 'Search receipt, cashier, product…'
      : location.pathname === '/products'
        ? 'Search products…'
        : location.pathname === '/inventory'
          ? 'Search inventory…'
          : 'Search SKU, product, receipt…';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleSidebarNavigate = (href) => {
    navigate(href);
    setSidebarOpen(false);
  };

  return (
    <div className="h-screen flex overflow-hidden bg-surface">
      <aside
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform lg:translate-x-0 lg:static lg:inset-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          dashboardItem={dashboardVisible ? DASHBOARD_ITEM : null}
          sections={visibleSections}
          activePath={location.pathname}
          onNavigate={handleSidebarNavigate}
          onClose={() => setSidebarOpen(false)}
          zraStatus={zraStatus}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {!isCashierRoute && (
        <header className="h-12 flex-shrink-0 bg-surface-raised border-b border-surface-border flex items-center justify-between px-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden btn-ghost p-1.5"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="relative max-w-md flex-1 hidden sm:block">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="search"
                  placeholder={headerSearchPlaceholder}
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  className="input-sys pl-8 py-1.5 h-8"
                  aria-label="Search"
                />
              </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost p-1.5 relative" aria-label="Notifications">
              <Bell className="w-4 h-4" />
            </button>
          </div>
        </header>
        )}

        <main
          className={`flex-1 min-h-0 ${
            isCashierRoute ? 'overflow-hidden p-0' : 'overflow-y-auto p-4'
          }`}
        >
          <Suspense fallback={<RouteFallback />}>
            <Outlet
              context={{
                openSidebar: () => setSidebarOpen(true),
                headerSearch,
                setHeaderSearch,
                zraStatus,
              }}
            />
          </Suspense>
        </main>
      </div>

      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="Close overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default MainLayout;
