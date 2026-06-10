import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  CreditCard,
  Package,
  Warehouse,
  BarChart2,
  Users,
  Settings,
  Menu,
  X,
  Search,
  Bell,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';

const NAV_ITEMS = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: () => true },
  { name: 'Cashier', href: '/cashier', icon: CreditCard, show: (p, u) => p.createSale || p.viewSales || u?.role === 'CASHIER' },
  { name: 'Products', href: '/products', icon: Package, show: (p) => p.viewProducts },
  { name: 'Inventory', href: '/inventory', icon: Warehouse, show: (p) => p.viewInventory },
  { name: 'Reports', href: '/reports', icon: BarChart2, show: (p) => p.viewReports },
  { name: 'Users', href: '/users', icon: Users, show: (p) => p.viewUsers },
  { name: 'Settings', href: '/settings', icon: Settings, show: (p) => p.manageSettings },
];

const MainLayout = () => {
  const { user, logout } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const navigation = NAV_ITEMS.filter((item) => item.show(permissions.canAccess, user));
  const isCashierRoute = location.pathname === '/cashier';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-surface-sidebar text-gray-300">
      <div className="h-12 flex items-center justify-between px-4 border-b border-white/10">
        <div>
          <div className="text-sm font-semibold text-white tracking-tight">Smart POS</div>
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">Terminal</div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden p-1 text-gray-400 hover:text-white"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.href;
          return (
            <button
              key={item.name}
              type="button"
              onClick={() => {
                navigate(item.href);
                setSidebarOpen(false);
              }}
              className={isActive ? 'nav-item-active' : 'nav-item'}
            >
              <Icon className="w-4 h-4 shrink-0 opacity-80" strokeWidth={1.75} />
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10 text-[11px] text-gray-500">
        ZRA VSDC · v2.0
      </div>
    </div>
  );

  return (
    <div className="h-screen flex overflow-hidden bg-surface">
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 transform transition-transform lg:translate-x-0 lg:static lg:inset-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar />
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
                  placeholder="Search SKU, product, receipt…"
                  className="input-sys pl-8 py-1.5 h-8"
                />
              </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost p-1.5 relative" aria-label="Notifications">
              <Bell className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 px-2 py-1 border border-surface-border rounded bg-gray-50 hover:bg-gray-100"
              >
                <span className="text-xs font-medium text-gray-800 max-w-[120px] truncate">
                  {user?.name}
                </span>
                <span className="text-[10px] text-gray-500 uppercase">{user?.role}</span>
                <ChevronDown className="w-3 h-3 text-gray-500" />
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-1 w-52 panel z-50 py-1">
                  <div className="px-3 py-2 border-b border-surface-border">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        )}

        <main
          className={`flex-1 min-h-0 ${
            isCashierRoute ? 'overflow-hidden p-0' : 'overflow-y-auto p-4'
          }`}
        >
          <Outlet context={{ openSidebar: () => setSidebarOpen(true) }} />
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
