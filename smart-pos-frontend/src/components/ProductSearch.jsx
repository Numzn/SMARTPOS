import { useState, useEffect, useRef } from 'react'

const ProductSearch = ({ onAddToCart }) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [products, setProducts] = useState([])
  const [filteredProducts, setFilteredProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [viewMode, setViewMode] = useState('grid')
  const [isLoading, setIsLoading] = useState(true)
  const [recentlyAdded, setRecentlyAdded] = useState([])
  const searchInputRef = useRef(null)

  // Mock data - replace with API calls to your backend
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      // Simulate API loading
      await new Promise(resolve => setTimeout(resolve, 800))
      
      const mockProducts = [
        { id: 1, name: 'Coca Cola 500ml', price: 8.50, category: 'beverages', barcode: '123456789', stock: 45, image: '🥤', featured: true },
        { id: 2, name: 'Bread Loaf White', price: 12.00, category: 'bakery', barcode: '987654321', stock: 20, image: '🍞', featured: false },
        { id: 3, name: 'Fresh Milk 1L', price: 15.50, category: 'dairy', barcode: '456789123', stock: 30, image: '🥛', featured: true },
        { id: 4, name: 'Basmati Rice 2kg', price: 35.00, category: 'groceries', barcode: '321654987', stock: 15, image: '🍚', featured: false },
        { id: 5, name: 'Chicken Breast 1kg', price: 45.00, category: 'meat', barcode: '789123456', stock: 8, image: '🍖', featured: true },
        { id: 6, name: 'Fresh Bananas 1kg', price: 18.00, category: 'fruits', barcode: '654987321', stock: 25, image: '🍌', featured: false },
        { id: 7, name: 'Pepsi 500ml', price: 8.00, category: 'beverages', barcode: '147258369', stock: 52, image: '🥤', featured: false },
        { id: 8, name: 'Greek Yogurt 500g', price: 22.50, category: 'dairy', barcode: '963852741', stock: 12, image: '🥛', featured: false },
        { id: 9, name: 'Red Apples 1kg', price: 25.00, category: 'fruits', barcode: '852741963', stock: 18, image: '🍎', featured: true },
        { id: 10, name: 'Whole Wheat Bread', price: 14.00, category: 'bakery', barcode: '741852963', stock: 16, image: '🍞', featured: false }
      ]
      
      const mockCategories = [
        { id: 'all', name: 'All Categories', icon: '📦' },
        { id: 'beverages', name: 'Beverages', icon: '🥤' },
        { id: 'bakery', name: 'Bakery', icon: '🍞' },
        { id: 'dairy', name: 'Dairy', icon: '🥛' },
        { id: 'groceries', name: 'Groceries', icon: '🍚' },
        { id: 'meat', name: 'Meat', icon: '🍖' },
        { id: 'fruits', name: 'Fruits', icon: '🍎' }
      ]
      
      setProducts(mockProducts)
      setCategories(mockCategories)
      setFilteredProducts(mockProducts)
      setIsLoading(false)
    }

    fetchData()
  }, [])

  // Auto-focus search input
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [])

  useEffect(() => {
    let filtered = products

    // Filter by category
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(product => product.category === selectedCategory)
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.barcode.includes(searchTerm)
      )
    }

    // Sort products
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'price_low':
          return a.price - b.price
        case 'price_high':
          return b.price - a.price
        case 'stock':
          return b.stock - a.stock
        case 'featured':
          return b.featured - a.featured
        default:
          return 0
      }
    })

    setFilteredProducts(filtered)
  }, [searchTerm, selectedCategory, products, sortBy])

  const handleQuickAdd = (product) => {
    onAddToCart(product, 1)
    setRecentlyAdded(prev => [product.id, ...prev.filter(id => id !== product.id)].slice(0, 3))
  }

  const handleBarcodeScanner = () => {
    // Simulate barcode scanner
    const mockBarcode = '123456789'
    const product = products.find(p => p.barcode === mockBarcode)
    if (product) {
      handleQuickAdd(product)
    }
  }

  const getStockBadge = (stock) => {
    if (stock > 10) return 'badge-success'
    if (stock > 0) return 'badge-warning'
    return 'badge-danger'
  }

  const ProductCard = ({ product }) => (
    <div className={`card-interactive group relative ${recentlyAdded.includes(product.id) ? 'ring-2 ring-green-400 animate-pulse' : ''}`}>
      {product.featured && (
        <div className="absolute top-2 right-2 bg-yellow-400 text-yellow-900 text-xs px-2 py-1 rounded-full font-bold">
          ⭐ Featured
        </div>
      )}
      
      <div className="flex justify-between items-start mb-3">
        <div className="text-3xl">{product.image}</div>
        <span className={`badge ${getStockBadge(product.stock)}`}>
          {product.stock} left
        </span>
      </div>
      
      <h3 className="font-semibold text-gray-900 text-sm mb-1 group-hover:text-blue-600 transition-colors">
        {product.name}
      </h3>
      
      <p className="text-gray-500 text-xs mb-2">
        Code: {product.barcode}
      </p>
      
      <div className="flex justify-between items-center">
        <span className="text-lg font-bold text-gray-900">
          K{product.price.toFixed(2)}
        </span>
        <button
          onClick={() => handleQuickAdd(product)}
          disabled={product.stock === 0}
          className={`btn-primary text-sm transform transition-all duration-200 ${
            product.stock === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110'
          }`}
        >
          {product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
        </button>
      </div>
    </div>
  )

  const ProductListItem = ({ product }) => (
    <div className={`flex items-center p-3 bg-white rounded-lg border hover:shadow-md transition-all duration-200 ${recentlyAdded.includes(product.id) ? 'ring-2 ring-green-400' : ''}`}>
      <div className="text-2xl mr-4">{product.image}</div>
      
      <div className="flex-1">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-semibold text-gray-900">{product.name}</h3>
          {product.featured && <span className="text-yellow-500">⭐</span>}
        </div>
        <p className="text-sm text-gray-500">Code: {product.barcode}</p>
      </div>
      
      <div className="text-right mr-4">
        <p className="font-bold text-lg">K{product.price.toFixed(2)}</p>
        <span className={`badge ${getStockBadge(product.stock)}`}>
          {product.stock} left
        </span>
      </div>
      
      <button
        onClick={() => handleQuickAdd(product)}
        disabled={product.stock === 0}
        className={`btn-primary ${product.stock === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        Add
      </button>
    </div>
  )

  if (isLoading) {
    return (
      <div className="flex-1 p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-300 rounded w-1/4"></div>
          <div className="h-10 bg-gray-300 rounded"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-32 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-4 animate-fade-in">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            🛍️ Product Catalog
          </h2>
          
          {/* View Mode Toggle */}
          <div className="flex space-x-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
              title="Grid View"
            >
              ⊞
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
              title="List View"
            >
              ≡
            </button>
          </div>
        </div>
        
        {/* Search Bar with Barcode Scanner */}
        <div className="mb-4 relative">
          <input
            ref={searchInputRef}
            id="search-input"
            type="text"
            placeholder="Search products or scan barcode... (Ctrl+F)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pr-12"
          />
          <button
            onClick={handleBarcodeScanner}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-blue-600 transition-colors"
            title="Barcode Scanner"
          >
            📷
          </button>
        </div>

        {/* Category Filter */}
        <div className="mb-4">
          <div className="flex flex-wrap gap-2">
            {categories.map(category => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`px-3 py-2 rounded-full text-sm font-medium transition-all duration-200 flex items-center space-x-1 ${
                  selectedCategory === category.id
                    ? 'bg-blue-600 text-white shadow-md transform scale-105'
                    : 'bg-white/70 text-gray-700 hover:bg-white hover:shadow-md'
                }`}
              >
                <span>{category.icon}</span>
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sort & Filter Controls */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
            >
              <option value="name">Name A-Z</option>
              <option value="price_low">Price: Low to High</option>
              <option value="price_high">Price: High to Low</option>
              <option value="stock">Stock Level</option>
              <option value="featured">Featured First</option>
            </select>
          </div>
          
          <div className="text-sm text-gray-600">
            Showing {filteredProducts.length} of {products.length} products
          </div>
        </div>
      </div>

      {/* Products Display */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProducts.map(product => (
            <ProductListItem key={product.id} product={product} />
          ))}
        </div>
      )}

      {filteredProducts.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <div className="text-6xl mb-4">🔍</div>
          <p className="text-lg font-medium">No products found</p>
          <p className="text-sm">Try adjusting your search or filter criteria</p>
        </div>
      )}
    </div>
  )
}

export default ProductSearch
