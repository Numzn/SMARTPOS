import { useAuth } from '../contexts/AuthContext';

export const usePermissions = () => {
  const { user } = useAuth();

  const hasPermission = (permission) => {
    if (!user) return false;
    
    // Admin has all permissions
    if (user.role === 'ADMIN') return true;
    
    // Check if user has specific permission
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
    
    // Product permissions
    manageProducts: hasPermission('products:write'),
    viewProducts: hasPermission('products:read'),
    
    // Inventory permissions
    manageInventory: hasPermission('inventory:write'),
    viewInventory: hasPermission('inventory:read'),
    
    // Reports permissions
    viewReports: hasPermission('reports:read'),
    manageReports: hasPermission('reports:write'),
    
    // User management
    manageUsers: hasPermission('users:write'),
    viewUsers: hasPermission('users:read'),
    
    // Settings
    manageSettings: hasPermission('settings:write'),
    
    // ZRA operations
    submitToZRA: hasPermission('zra:submit'),
    viewZRAStatus: hasPermission('zra:read')
  };

  return {
    hasPermission,
    hasRole,
    hasAnyRole,
    canAccess,
    user
  };
};
