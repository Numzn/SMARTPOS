// Product validation utilities

export const validateProductForm = (productData) => {
  const errors = {};
  
  if (!productData.name.trim()) errors.name = 'Product name is required';
  if (!productData.sku.trim()) errors.sku = 'SKU is required';
  if (!productData.price || parseFloat(productData.price) <= 0) {
    errors.price = 'Valid price is required';
  }
  if (!productData.categoryId) errors.categoryId = 'Category is required';
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

// Export utilities
export const exportProductsToCSV = (products, categories, getInventoryInfo) => {
  const csvContent = [
    ['Name', 'SKU', 'Price', 'Cost', 'Category', 'Stock', 'Status'],
    ...products.map(product => {
      const category = categories.find(cat => cat.id === product.categoryId);
      const inventoryInfo = getInventoryInfo(product.id);
      return [
        product.name,
        product.sku,
        product.price,
        product.cost || 0,
        category?.name || 'Unknown',
        inventoryInfo.currentStock,
        product.isActive ? 'Active' : 'Inactive'
      ];
    })
  ].map(row => row.join(',')).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `products_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
};

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

export const navigateToInventory = (productId) => {
  // Store the product ID for filtering in inventory page
  localStorage.setItem('inventoryFilter', productId);
  window.location.href = '#/inventory';
};
