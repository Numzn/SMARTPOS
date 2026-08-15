import { useAuth } from '../contexts/AuthContext';

export const usePermissions = () => {
  const { user } = useAuth();

  // No role-based bypass here, including for ADMIN — every role's access,
  // ADMIN included, comes purely from user.permissions, which the backend
  // resolves from the configurable RolePermission table (see
  // lib/permissions.js on the backend). A hard-coded "ADMIN = everything"
  // shortcut here would be a second, unconfigurable authorization model.
  const hasPermission = (permission) => {
    if (!user) return false;
    return user.permissions?.includes(permission) || false;
  };

  const hasRole = (role) => {
    if (!user) return false;
    return user.role === role;
  };

  const hasAnyRole = (roles) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const canAccess = {
    // Sales permissions
    createSale: hasPermission('sales:write'),
    viewSales: hasPermission('sales:read'),
    refundSale: hasPermission('sales:refund'),

    // Product / inventory management modules — distinct from the in-POS
    // catalog/stock lookup the Cashier/Sales pages use, which the backend
    // leaves open (see routes/products.js's optionalAuth routes) rather
    // than gating behind these.
    manageProducts: hasPermission('products:write'),
    viewProducts: hasPermission('products:read'),
    manageInventory: hasPermission('inventory:write'),
    viewInventory: hasPermission('inventory:read'),

    // Reports permissions
    viewReports: hasPermission('reports:read'),
    manageReports: hasPermission('reports:write'),

    // User management
    manageUsers: hasPermission('users:write'),
    viewUsers: hasPermission('users:read'),

    // Customers
    manageCustomers: hasPermission('customers:write'),
    viewCustomers: hasPermission('customers:read'),

    // Suppliers
    manageSuppliers: hasPermission('suppliers:write'),
    viewSuppliers: hasPermission('suppliers:read'),

    // Purchasing (purchase orders, GRNs, supplier returns)
    managePurchasing: hasPermission('purchasing:write'),
    viewPurchasing: hasPermission('purchasing:read'),

    // Cash register / shifts — granular segregation of duties. Operating a
    // till (own drawer, cash movements, ending a shift) is not the same as
    // reconciling one (expected cash, counting, variance, closing) — a
    // Cashier gets the former only; a Cashier can never see the latter,
    // even for their own shift.
    operateShift: hasPermission('shifts:operate'),
    viewExpectedCash: hasPermission('shifts:viewExpected'),
    countCash: hasPermission('shifts:countCash'),
    viewVariance: hasPermission('shifts:viewVariance'),
    reconcileShift: hasPermission('shifts:reconcile'),
    viewAllShifts: hasPermission('shifts:viewAll'),
    reopenShift: hasPermission('shifts:reopen'),

    // Settings
    viewSettings: hasPermission('settings:read'),
    manageSettings: hasPermission('settings:write'),

    // ZRA — four distinct tiers. viewZRAStatus (zra:status) is the
    // lightweight device/connectivity check the POS uses and never implies
    // page access; viewZRAPage (zra:read) is what actually gates the ZRA
    // Sync page.
    viewZRAStatus: hasPermission('zra:status'),
    viewZRAPage: hasPermission('zra:read'),
    syncZRA: hasPermission('zra:sync'),
    submitToZRA: hasPermission('zra:submit'),
    adminZRA: hasPermission('zra:admin'),

    // Configurable RBAC administration
    manageRoles: hasPermission('roles:manage'),

    // Audit trail
    viewAuditLog: hasPermission('audit:read')
  };

  return {
    hasPermission,
    hasRole,
    hasAnyRole,
    canAccess,
    user
  };
};
