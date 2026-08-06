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
const vsdcRoutes = require('./routes/vsdc');
const branchRoutes = require('./routes/branches');
const itemRoutes = require('./routes/items'); // Add items route for VSDC Section 6.1
const stockAdjustmentRoutes = require('./routes/stock-adjustments'); // ZRA stock management compliance
const receiptRoutes = require('./routes/receipts');
const settingsRoutes = require('./routes/settings');
const auditRoutes = require('./routes/audit');
const reportRoutes = require('./routes/reports');
const printerRoutes = require('./routes/printers');
const shiftRoutes = require('./routes/shifts');
const customerRoutes = require('./routes/customers');
const supplierRoutes = require('./routes/suppliers');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const goodsReceivedNoteRoutes = require('./routes/goodsReceivedNotes');
const supplierReturnRoutes = require('./routes/supplierReturns');
const auditService = require('./services/auditService');

dotenv.config();

const { assertRequiredEnv } = require('./lib/validateEnv');
assertRequiredEnv();

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
app.use('/api/vsdc', vsdcRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/items', itemRoutes); // VSDC Item Management endpoints (Section 6.1)
app.use('/api/stock-adjustments', stockAdjustmentRoutes); // ZRA stock management compliance
app.use('/api/receipts', receiptRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings/printers', printerRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/goods-received-notes', goodsReceivedNoteRoutes);
app.use('/api/supplier-returns', supplierReturnRoutes);

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
  console.log(`   - Branches: http://localhost:${PORT}/api/branches`);

  if (process.env.FISCAL_RECONCILE_ENABLED !== 'false') {
    const { reconcileStuckFiscalRecords } = require('./lib/fiscalReconcile');
    const intervalMs = parseInt(process.env.FISCAL_RECONCILE_INTERVAL_MS || '300000', 10);
    const runReconcile = () => {
      reconcileStuckFiscalRecords().catch((err) => {
        console.error('[Fiscal Reconcile] Scheduled run failed:', err.message);
      });
    };
    setTimeout(runReconcile, 30_000);
    setInterval(runReconcile, intervalMs);
    console.log(`🔄 Fiscal reconciliation scheduled every ${intervalMs / 1000}s`);
  }

  if (process.env.STOCK_RECONCILE_ENABLED !== 'false') {
    const { reconcileReservedStock } = require('./lib/inventoryStock');
    const intervalMs = parseInt(process.env.STOCK_RECONCILE_INTERVAL_MS || '300000', 10);
    const runStockReconcile = () => {
      reconcileReservedStock()
        .then(({ corrected, orphansCleared }) => {
          if (corrected || orphansCleared) {
            console.log(`🔧 Stock reservation reconcile: corrected ${corrected}, cleared ${orphansCleared} orphaned reservation(s)`);
          }
        })
        .catch((err) => {
          console.error('[Stock Reconcile] Scheduled run failed:', err.message);
        });
    };
    setTimeout(runStockReconcile, 45_000);
    setInterval(runStockReconcile, intervalMs);
    console.log(`🔧 Reserved-stock reconciliation scheduled every ${intervalMs / 1000}s`);
  }

  auditService.safeLog(auditService.eventTypes.SYSTEM_START, {
    description: `Smart POS backend started on ${HOST}:${PORT}`,
  });
});

// Audit graceful shutdown (best-effort — awaited so the entry is flushed before exit).
['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, async () => {
    try {
      await auditService.logSystemEvent(
        auditService.eventTypes.SYSTEM_SHUTDOWN,
        `Smart POS backend received ${signal}`
      );
    } catch (err) {
      console.warn('[audit] shutdown log skipped:', err.message);
    }
    process.exit(0);
  });
});

module.exports = app;
