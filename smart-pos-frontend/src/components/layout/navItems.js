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

// Every predicate is permission-driven except Dashboard, which is a
// deliberate, one-off role check: a Cashier has no dashboard workspace at
// all (their journey is login -> straight to /cashier — see lib/roleHome.js),
// not a page that happens to be hidden. Everything else — including what
// Supervisor gets beyond Cashier's baseline (approvals/reconciliation) —
// lives inside these same four items, not as extra nav entries; Supervisor
// intentionally is not a mini-Manager with its own expanded sidebar.
export const NAV_ITEMS = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: (p, u) => u?.role !== 'CASHIER' },
  { name: 'Cashier', href: '/cashier', icon: CreditCard, show: (p) => p.createSale || p.viewSales },
  { name: 'Sales', href: '/sales', icon: Receipt, show: (p) => p.viewSales || p.refundSale },
  { name: 'Cash Register', href: '/cash-register', icon: Wallet, show: (p) => p.operateShift || p.recordCashMovement || p.reconcileShift || p.viewAllShifts },
  { name: 'Customers', href: '/customers', icon: Contact, show: (p) => p.viewCustomers },
  { name: 'Products', href: '/products', icon: Package, show: (p) => p.viewProducts },
  { name: 'Inventory', href: '/inventory', icon: Warehouse, show: (p) => p.viewInventory },
  { name: 'Suppliers', href: '/suppliers', icon: Truck, show: (p) => p.viewSuppliers },
  { name: 'Purchasing', href: '/purchasing', icon: ShoppingCart, show: (p) => p.viewPurchasing },
  { name: 'Reports', href: '/reports', icon: BarChart2, show: (p) => p.viewReports },
  { name: 'Users', href: '/users', icon: Users, show: (p) => p.viewUsers },
  { name: 'Settings', href: '/settings', icon: Settings, show: (p) => p.viewSettings || p.manageSettings },
  { name: 'Printers', href: '/printers', icon: Printer, show: (p) => p.viewSettings || p.manageSettings },
  // zra:read (viewZRAPage), never zra:status (viewZRAStatus) — the latter is
  // the till's lightweight connectivity check and must never surface this
  // nav item on its own.
  { name: 'ZRA Sync', href: '/zra-sync', icon: Satellite, show: (p) => p.viewZRAPage },
  { name: 'Roles', href: '/roles', icon: ShieldCheck, show: (p) => p.manageRoles },
  { name: 'Audit Log', href: '/audit', icon: History, show: (p) => p.viewAuditLog },
];
