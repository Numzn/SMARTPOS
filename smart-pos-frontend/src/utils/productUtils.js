// Product validation utilities

export const validateProductForm = (productData) => {
  const errors = {};
  
  if (!productData.name.trim()) errors.name = 'Product name is required';
  if (!productData.sku.trim()) errors.sku = 'SKU is required';
  if (!productData.price || parseFloat(productData.price) <= 0) {
    errors.price = 'Valid price is required';
  }
  if (!productData.categoryId) errors.categoryId = 'Category is required';
  // Mirrors lib/productRegistration.js validateRegistrationFields on the
  // backend (enforced there whenever ZRA_REGISTRATION_STRICT !== 'false',
  // the default) — catch it client-side too instead of round-tripping.
  if (!productData.zraClassificationCode) {
    errors.zraClassificationCode = 'ZRA classification code is required — search and select one';
  }
  if (productData.hasExpiry && (!productData.shelfLifeDays || parseInt(productData.shelfLifeDays) <= 0)) {
    errors.shelfLifeDays = 'Shelf life days required for perishable items';
  }
  
  return errors;
};

// Product filtering utilities
export const filterProducts = (products, categories, searchTerm, filterBy) => {
  return products.filter(product => {
    const category = categories.find(cat => cat.id === product.categoryId);
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (category?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    if (filterBy === 'active') return matchesSearch && product.isActive;
    if (filterBy === 'inactive') return matchesSearch && !product.isActive;
    if (filterBy === 'low-stock') {
      // This requires inventory info, will be handled in the component
      return matchesSearch;
    }
    if (filterBy === 'out-of-stock') {
      // This requires inventory info, will be handled in the component
      return matchesSearch;
    }
    
    return matchesSearch;
  });
};

// Product export now lives server-side (GET /api/products/export). It emits
// exactly the columns the importer accepts so a catalogue round-trips, and it
// escapes fields properly — this client-side version joined on commas with no
// quoting, so a single product name containing a comma corrupted the file.

// Initial product data
export const getInitialProductData = () => ({
  name: '',
  sku: '',
  price: '',
  cost: '',
  categoryId: '',
  description: '',
  taxRate: '16',
  isActive: true,
  // ZRA Compliance fields
  zraClassificationCode: '',
  vatCategoryCode: 'STANDARD',
  exciseTaxCode: '',
  hasExpiry: false,
  shelfLifeDays: '',
  // Inventory fields
  minStockLevel: '',
  initialQuantity: ''
});

// VAT Categories for ZRA compliance
export const vatCategories = [
  { value: 'STANDARD', label: 'Standard Rate (16%)' },
  { value: 'EXEMPT', label: 'VAT Exempt' },
  { value: 'ZERO_RATED', label: 'Zero Rated' }
];

// Inventory utilities
export const getInventoryInfo = (inventory, productId) => {
  const inventoryItem = inventory.find(item => item.productId === productId);
  return inventoryItem || { currentStock: 0, totalValue: 0, lowStockAlert: false };
};

export const getStockStatus = (inventory, productId) => {
  const inventoryInfo = getInventoryInfo(inventory, productId);
  const stock = inventoryInfo.currentStock;
  
  if (stock === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-800' };
  if (inventoryInfo.lowStockAlert) return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800' };
  return { label: 'In Stock', color: 'bg-green-100 text-green-800' };
};

/** Cashier / product list: uses API lowStockAlert or minStockLevel vs current stock. */
export const isProductRegisteredForSale = (product) =>
  product?.zraRegistrationStatus === 'REGISTERED';

export const getRegistrationStatusBadge = (status) => {
  switch (status) {
    case 'REGISTERED':
      return { label: 'Registered', className: 'bg-green-100 text-green-800' };
    case 'FAILED':
      return { label: 'Reg. failed', className: 'bg-red-100 text-red-800' };
    default:
      return { label: 'Pending', className: 'bg-yellow-100 text-yellow-800' };
  }
};

export const isProductLowStock = (product) => {
  const stock = product?.stock ?? 0;
  if (stock <= 0) return false;
  if (typeof product?.lowStockAlert === 'boolean') return product.lowStockAlert;
  return stock <= (product?.minStockLevel ?? 0);
};

export const getCashierStockStatus = (product) => {
  const stock = product?.stock ?? 0;

  if (stock <= 0) {
    return {
      status: 'out',
      label: 'Out of stock',
      color: 'text-red-700',
      bg: 'bg-red-50 border border-red-200',
    };
  }

  if (isProductLowStock(product)) {
    return {
      status: 'low',
      label: `Low stock · ${stock}`,
      color: 'text-orange-700',
      bg: 'bg-orange-50 border border-orange-200',
    };
  }

  return null;
};

export const navigateToInventory = (productId, productName) => {
  localStorage.setItem('inventoryFilter', productName || productId);
  window.location.href = '/inventory';
};
