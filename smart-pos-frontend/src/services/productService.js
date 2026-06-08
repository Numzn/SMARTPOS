import { apiFetch } from '../lib/apiClient';

export const productApi = {
  fetchProducts: () => apiFetch('/products'),

  createProduct: (productData) => {
    const payload = {
      ...productData,
      price: parseFloat(productData.price),
      cost: productData.cost ? parseFloat(productData.cost) : null,
      taxRate: parseFloat(productData.taxRate),
      minStockLevel: productData.minStockLevel ? parseInt(productData.minStockLevel, 10) : 0,
      initialQuantity: productData.initialQuantity
        ? parseInt(productData.initialQuantity, 10)
        : null,
      shelfLifeDays:
        productData.hasExpiry && productData.shelfLifeDays
          ? parseInt(productData.shelfLifeDays, 10)
          : null,
    };
    return apiFetch('/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProduct: (productId, productData) => {
    const payload = {
      ...productData,
      price: parseFloat(productData.price),
      cost: productData.cost ? parseFloat(productData.cost) : null,
      taxRate: parseFloat(productData.taxRate),
      minStockLevel: productData.minStockLevel ? parseInt(productData.minStockLevel, 10) : 0,
      shelfLifeDays:
        productData.hasExpiry && productData.shelfLifeDays
          ? parseInt(productData.shelfLifeDays, 10)
          : null,
    };
    return apiFetch(`/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteProduct: (productId) =>
    apiFetch(`/products/${productId}`, { method: 'DELETE' }),
};

export const categoryApi = {
  fetchCategories: () => apiFetch('/categories'),

  createDefaultCategories: async () => {
    const defaultCategories = [
      { name: 'Electronics', description: 'Electronic devices and accessories' },
      { name: 'Clothing', description: 'Apparel and fashion items' },
      { name: 'Food & Beverages', description: 'Food items and drinks' },
      { name: 'Books', description: 'Books and educational materials' },
      { name: 'Home & Garden', description: 'Home improvement and garden supplies' },
      { name: 'Sports & Outdoors', description: 'Sports equipment and outdoor gear' },
    ];

    const created = [];
    for (const category of defaultCategories) {
      try {
        const row = await apiFetch('/categories', {
          method: 'POST',
          body: JSON.stringify(category),
        });
        created.push(row);
      } catch {
        /* category may already exist */
      }
    }
    return created;
  },
};

export const inventoryApi = {
  fetchInventoryOverview: async () => {
    const data = await apiFetch('/inventory');
    return data.inventory || data;
  },
};
