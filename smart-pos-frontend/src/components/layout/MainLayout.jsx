import React, { Suspense, useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  CreditCard,
  Package,
  Warehouse,
  BarChart2,
  Users,
  Settings,
  Printer,
  Menu,
  X,
  Search,
  Bell,
  LogOut,
  ChevronDown,
  Receipt,
  Contact,
  Truck,
  ShoppingCart,
  Wallet,
  Satellite,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';

const NAV_ITEMS = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: () => true },
  { name: 'Cashier', href: '/cashier', icon: CreditCard, show: (p, u) => p.createSale || p.viewSales || u?.role === 'CASHIER' },
  { name: 'Sales', href: '/sales', icon: Receipt, show: (p) => p.viewSales || p.refundSale },
  { name: 'Cash Register', href: '/cash-register', icon: Wallet, show: (p) => p.operateShift || p.viewShifts },
  { name: 'Products', href: '/products', icon: Package, show: (p) => p.viewProducts },
  { name: 'Inventory', href: '/inventory', icon: Warehouse, show: (p) => p.viewInventory },
  { name: 'Customers', href: '/customers', icon: Contact, show: (p) => p.viewCustomers },
  { name: 'Suppliers', href: '/suppliers', icon: Truck, show: (p) => p.viewSuppliers },
  { name: 'Purchasing', href: '/purchasing', icon: ShoppingCart, show: (p) => p.viewPurchasing },
  { name: 'Reports', href: '/reports', icon: BarChart2, show: (p) => p.viewReports },
  { name: 'Users', href: '/users', icon: Users, show: (p) => p.viewUsers },
  { name: 'Settings', href: '/settings', icon: Settings, show: (p) => p.viewSettings || p.manageSettings },
  { name: 'Printers', href: '/printers', icon: Printer, show: (p) => p.viewSettings || p.manageSettings },
  { name: 'ZRA Sync', href: '/zra-sync', icon: Satellite, show: (p) => p.viewZRAStatus },
];

// A stable top-level component, not one defined inside MainLayout's render
// body — a component declared per-render gets a new identity every time, so
// React would unmount and remount the entire sidebar DOM subtree on every
// MainLayout re-render (every route change, every header-search keystroke)
// instead of diffing it like a normal element.
const Sidebar = ({ navigation, activePath, onNavigate, onClose }) => (
  <div className="flex flex-col h-full bg-surface-sidebar text-gray-300">
    <div className="h-12 flex items-center justify-between px-4 border-b border-white/10">
      <div>
        <div className="text-sm font-semibold text-white tracking-tight">Smart POS</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-widest">Terminal</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="lg:hidden p-1 text-gray-400 hover:text-white"
        aria-label="Close menu"
      >
        <X className="w-4 h-4" />
      </button>
    </div>

    <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
      {navigation.map((item) => {
        const Icon = item.icon;
        const isActive = activePath === item.href;
        return (
          <button
            key={item.name}
            type="button"
            onClick={() => onNavigate(item.href)}
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');

  const navigation = NAV_ITEMS.filter((item) => item.show(permissions.canAccess, user));
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
        className={`fixed inset-y-0 left-0 z-50 w-56 transform transition-transform lg:translate-x-0 lg:static lg:inset-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          navigation={navigation}
          activePath={location.pathname}
          onNavigate={handleSidebarNavigate}
          onClose={() => setSidebarOpen(false)}
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
          <Suspense fallback={<RouteFallback />}>
            <Outlet
              context={{
                openSidebar: () => setSidebarOpen(true),
                headerSearch,
                setHeaderSearch,
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
