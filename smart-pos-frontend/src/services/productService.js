// API service for products
import Cookies from 'js-cookie';

const API_BASE_URL = 'http://localhost:4000/api';

// Helper function to get token
const getAuthToken = () => {
  // First try cookies (primary auth method)
  let token = Cookies.get('token');
  
  // Fallback to localStorage for backward compatibility
  if (!token) {
    token = localStorage.getItem('token');
  }
  
  return token;
};

export const productApi = {
  // Fetch all products
  fetchProducts: async () => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/products`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.statusText}`);
    }
    
    return await response.json();
  },

  // Create a new product
  createProduct: async (productData) => {
    const token = getAuthToken();
    const payload = {
      ...productData,
      price: parseFloat(productData.price),
      cost: productData.cost ? parseFloat(productData.cost) : null,
      taxRate: parseFloat(productData.taxRate),
      minStockLevel: productData.minStockLevel ? parseInt(productData.minStockLevel) : 0,
      initialQuantity: productData.initialQuantity ? parseInt(productData.initialQuantity) : null,
      shelfLifeDays: productData.hasExpiry && productData.shelfLifeDays ? 
        parseInt(productData.shelfLifeDays) : null
    };

    // Debug: Log the payload being sent
    console.log('[ProductService] Creating product with payload:', payload);

    const response = await fetch(`${API_BASE_URL}/products`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Debug: Log the response status
    console.log('[ProductService] Create product response status:', response.status);

    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Failed to parse error response' };
      }
      console.error('[ProductService] Create product error:', errorData);
      throw new Error(errorData.error || 'Failed to create product');
    }

    const data = await response.json();
    console.log('[ProductService] Create product success:', data);
    return data;
  },

  // Update an existing product
  updateProduct: async (productId, productData) => {
    const token = getAuthToken();
    
    // Debug: Log token info
    console.log('Token status:', {
      hasToken: !!token,
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 20) + '...' : 'No token'
    });
    
    if (!token) {
      throw new Error('No authentication token found. Please log in again.');
    }
    
    const payload = {
      ...productData,
      price: parseFloat(productData.price),
      cost: productData.cost ? parseFloat(productData.cost) : null,
      taxRate: parseFloat(productData.taxRate),
      minStockLevel: productData.minStockLevel ? parseInt(productData.minStockLevel) : 0,
      shelfLifeDays: productData.hasExpiry && productData.shelfLifeDays ? 
        parseInt(productData.shelfLifeDays) : null
    };

    console.log('Making PUT request to:', `${API_BASE_URL}/products/${productId}`);
    console.log('Payload:', payload);

    const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error response:', errorData);
      throw new Error(errorData.error || 'Failed to update product');
    }

    return await response.json();
  },

  // Delete a product
  deleteProduct: async (productId) => {
    const token = getAuthToken();
    
    console.log('[ProductService] Deleting product:', productId);
    
    const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[ProductService] Delete product response status:', response.status);

    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: 'Failed to parse error response' };
      }
      console.error('[ProductService] Delete product error:', errorData);
      throw new Error(errorData.error || 'Failed to delete product');
    }

    const data = await response.json();
    console.log('[ProductService] Delete product success:', data);
    return data;
  }
};

export const categoryApi = {
  // Fetch all categories
  fetchCategories: async () => {
    const token = getAuthToken();
    
    console.log('🏷️ Fetching categories...');
    console.log('Token status:', {
      hasToken: !!token,
      tokenLength: token ? token.length : 0
    });
    
    if (!token) {
      throw new Error('No authentication token found. Please log in again.');
    }
    
    const response = await fetch(`${API_BASE_URL}/categories`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Categories response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Categories fetch error:', errorText);
      throw new Error(`Failed to fetch categories: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Categories fetched successfully:', data);
    return data;
  },

  // Create default categories
  createDefaultCategories: async () => {
    console.log('🏗️ Creating default categories...');
    
    const defaultCategories = [
      { name: 'Electronics', description: 'Electronic devices and accessories' },
      { name: 'Clothing', description: 'Apparel and fashion items' },
      { name: 'Food & Beverages', description: 'Food items and drinks' },
      { name: 'Books', description: 'Books and educational materials' },
      { name: 'Home & Garden', description: 'Home improvement and garden supplies' },
      { name: 'Sports & Outdoors', description: 'Sports equipment and outdoor gear' }
    ];

    const token = getAuthToken();
    
    if (!token) {
      throw new Error('No authentication token found. Please log in again.');
    }
    
    const createdCategories = [];

    for (const category of defaultCategories) {
      console.log(`Creating category: ${category.name}`);
      
      const response = await fetch(`${API_BASE_URL}/categories`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(category)
      });

      if (response.ok) {
        const newCategory = await response.json();
        createdCategories.push(newCategory);
        console.log(`✅ Created category: ${category.name}`);
      } else {
        const errorText = await response.text();
        console.error(`❌ Failed to create category ${category.name}:`, errorText);
      }
    }

    console.log(`🎉 Created ${createdCategories.length} categories successfully`);
    return createdCategories;
  }
};

export const inventoryApi = {
  // Fetch inventory overview
  fetchInventoryOverview: async () => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/inventory`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch inventory: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.inventory || data;
  }
};
