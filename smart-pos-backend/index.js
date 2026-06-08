const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Import routes
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const inventoryRoutes = require('./routes/inventory'); // Now uses routes/inventory/index.js
const saleRoutes = require('./routes/sales');
const userRoutes = require('./routes/users');
const zraRoutes = require('./routes/zra');
const branchRoutes = require('./routes/branches');
const itemRoutes = require('./routes/items'); // Add items route for VSDC Section 6.1
const stockAdjustmentRoutes = require('./routes/stock-adjustments'); // ZRA stock management compliance

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/zra', zraRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/items', itemRoutes); // VSDC Item Management endpoints (Section 6.1)
app.use('/api/stock-adjustments', stockAdjustmentRoutes); // ZRA stock management compliance

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Smart POS Backend is running!',
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✅ Smart POS Server running on http://${HOST}:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
  console.log(`🔗 API Endpoints:`);
  console.log(`   - Products: http://localhost:${PORT}/api/products`);
  console.log(`   - Categories: http://localhost:${PORT}/api/categories`);
  console.log(`   - Sales: http://localhost:${PORT}/api/sales`);
  console.log(`   - Users: http://localhost:${PORT}/api/users`);
  console.log(`   - ZRA: http://localhost:${PORT}/api/zra`);
});

module.exports = app;
