import {
  LayoutDashboard,
  CreditCard,
  Package,
  Warehouse,
  BarChart2,
  Users,
  Settings,
  Printer,
  Receipt,
  Contact,
  Truck,
  ShoppingCart,
  Wallet,
  Satellite,
  History,
  ShieldCheck,
} from 'lucide-react';

// Dashboard is a deliberate, one-off role check, not a permission predicate:
// a Cashier has no dashboard workspace at all (their journey is login ->
// straight to /cashier — see lib/roleHome.js), not a page that happens to be
// hidden. It sits above every section as the sidebar's global home, not
// grouped with anything — see MainLayout.jsx's ungrouped rendering of it.
export const DASHBOARD_ITEM = { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: (p, u) => u?.role !== 'CASHIER' };

// Grouped by how the business operates day-to-day, not by database table.
// Every item's show() predicate is unchanged from the old flat NAV_ITEMS —
// only the grouping is new. A section with zero visible items (computed in
// MainLayout.jsx) doesn't render at all, header included — what Supervisor
// gets beyond Cashier's baseline (approvals/reconciliation) lives inside
// Cash Register, not as extra sections; Supervisor intentionally is not a
// mini-Manager with its own expanded sidebar.
export const NAV_SECTIONS = [
  {
    id: 'operations',
    label: 'OPERATIONS',
    items: [
      { name: 'Cashier', href: '/cashier', icon: CreditCard, show: (p) => p.createSale || p.viewSales },
      { name: 'Sales', href: '/sales', icon: Receipt, show: (p) => p.viewSales || p.refundSale },
      // Not operateShift/recordCashMovement — CashRegisterPage is back-office-only
      // (Active Tills/Pending Reconciliation/History), gated entirely on
      // reconcileShift/viewAllShifts. A Cashier (operateShift only) manages their
      // own shift from /cashier's Shift & Cash tab, not here — showing this item
      // to them would be a dead link to a "no permission" page.
      { name: 'Cash Register', href: '/cash-register', icon: Wallet, show: (p) => p.reconcileShift || p.viewAllShifts },
    ],
  },
  {
    id: 'catalog',
    label: 'CATALOG',
    items: [
      { name: 'Products', href: '/products', icon: Package, show: (p) => p.viewProducts },
      { name: 'Inventory', href: '/inventory', icon: Warehouse, show: (p) => p.viewInventory },
      { name: 'Customers', href: '/customers', icon: Contact, show: (p) => p.viewCustomers },
    ],
  },
  {
    id: 'supply',
    label: 'SUPPLY',
    items: [
      { name: 'Purchasing', href: '/purchasing', icon: ShoppingCart, show: (p) => p.viewPurchasing },
      { name: 'Suppliers', href: '/suppliers', icon: Truck, show: (p) => p.viewSuppliers },
    ],
  },
  {
    id: 'insights',
    label: 'INSIGHTS',
    items: [
      { name: 'Reports', href: '/reports', icon: BarChart2, show: (p) => p.viewReports },
    ],
  },
  {
    id: 'administration',
    label: 'ADMINISTRATION',
    items: [
      { name: 'Users', href: '/users', icon: Users, show: (p) => p.viewUsers },
      { name: 'Roles & Permissions', href: '/roles', icon: ShieldCheck, show: (p) => p.manageRoles },
      { name: 'Printers', href: '/printers', icon: Printer, show: (p) => p.viewSettings || p.manageSettings },
      { name: 'Settings', href: '/settings', icon: Settings, show: (p) => p.viewSettings || p.manageSettings },
    ],
  },
  {
    id: 'compliance',
    label: 'COMPLIANCE',
    items: [
      // zra:read (viewZRAPage), never zra:status (viewZRAStatus) — the latter is
      // the till's lightweight connectivity check and must never surface this
      // nav item on its own.
      { name: 'ZRA Sync', href: '/zra-sync', icon: Satellite, show: (p) => p.viewZRAPage },
      { name: 'Audit Log', href: '/audit', icon: History, show: (p) => p.viewAuditLog },
    ],
  },
];
