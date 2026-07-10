const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { sendEscPos } = require('../lib/print/escposSend');
const { buildEscPosCommands } = require('@smartpos/receipt-engine');
const auditService = require('../services/auditService');

const sampleVm = () => ({
  merchant: { brand: 'NUMZPAY', tradingName: 'Test Print', tpin: '0000000000', branchName: 'Main', address: '', phone: null, logoUrl: null },
  transaction: { date: '01/07/2026', time: '12:00', cashier: 'Test', receiptNo: 'TEST', invoiceNo: '1', itemCount: 1 },
  items: [{ name: 'Test Item', qty: 1, unitPrice: 10, lineTotal: 10 }],
  totals: { subtotal: 8.62, vat: 1.38, vatLabel: 'VAT (16%)', discount: 0, total: 10 },
  payment: { method: 'CASH', amountPaid: 10, change: 0 },
  fiscal: { mode: 'ONLINE', submissionStatus: 'SUBMITTED', submissionTime: null, sdcId: null, fiscalReceiptNo: null, receiptSignature: null, verificationCode: null, qrPayload: null, fiscalInvoiceNo: null },
  customer: { name: 'TEST', tpin: null, showTpin: false },
  footer: { lines: ['Printer test OK'], showPoweredBy: false, poweredByLine: '', fiscalizedLine: '' },
  receiptMeta: { receiptType: 'SALE', originalReceiptNo: null, isCopy: false, printedAt: null, printedBy: null, reprintCount: 0, version: '1.0' },
});

router.get('/status', authenticateToken, requireAnyPermission('settings:read', 'receipts:read'), async (req, res) => {
  try {
    const def = await prisma.printerProfile.findFirst({
      where: { isDefault: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!def) {
      return res.json({ status: 'none', message: 'No default printer configured' });
    }
    if (def.type === 'BROWSER') {
      return res.json({ status: 'ready', printer: def, message: 'Browser print default' });
    }
    const ok = def.lastTestOk === true;
    return res.json({
      status: ok ? 'ready' : def.lastTestOk === false ? 'error' : 'unknown',
      printer: def,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get printer status' });
  }
});

router.post('/receipt', authenticateToken, requirePermission('receipts:read'), async (req, res) => {
  try {
    const { viewModel, printerId } = req.body;
    if (!viewModel) {
      return res.status(400).json({ error: 'viewModel is required' });
    }

    let printer = null;
    if (printerId) {
      printer = await prisma.printerProfile.findUnique({ where: { id: printerId } });
    } else {
      printer = await prisma.printerProfile.findFirst({
        where: { isDefault: true, type: 'ESCPOS_NETWORK' },
      });
    }

    if (!printer || printer.type !== 'ESCPOS_NETWORK') {
      return res.status(400).json({ error: 'No ESC/POS network printer configured' });
    }
    if (!printer.host) {
      return res.status(400).json({ error: 'Printer host missing' });
    }

    const bytes = buildEscPosCommands(viewModel);
    await sendEscPos(printer.host, printer.port || 9100, bytes);

    await prisma.printerProfile.update({
      where: { id: printer.id },
      data: { lastTestAt: new Date(), lastTestOk: true },
    });

    await auditService.logEvent(auditService.eventTypes.RECEIPT_REPRINT, {
      entityType: 'RECEIPT',
      entityId: viewModel.transaction?.receiptNo || 'unknown',
      description: `ESC/POS print via ${printer.name}`,
      metadata: { printerId: printer.id },
    }).catch(() => null);

    res.json({ success: true, printerId: printer.id });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Print failed' });
  }
});

router.get('/', authenticateToken, requirePermission('settings:read'), async (req, res) => {
  try {
    const printers = await prisma.printerProfile.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(printers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list printers' });
  }
});

router.post('/', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const { name, type, format, host, port, isDefault, branchId } = req.body;
    if (!name || !type) {
      return res.status(400).json({ error: 'name and type are required' });
    }
    if (isDefault) {
      await prisma.printerProfile.updateMany({ data: { isDefault: false } });
    }
    const printer = await prisma.printerProfile.create({
      data: {
        name: String(name),
        type,
        format: format || 'thermal',
        host: host || null,
        port: port ? Number(port) : 9100,
        isDefault: Boolean(isDefault),
        branchId: branchId || null,
      },
    });
    res.status(201).json(printer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create printer' });
  }
});

router.post('/:id/test', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const printer = await prisma.printerProfile.findUnique({ where: { id: req.params.id } });
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    if (printer.type === 'BROWSER') {
      return res.json({ success: true, message: 'Use browser print from checkout' });
    }

    if (!printer.host) {
      return res.status(400).json({ error: 'Printer host is required for ESC/POS' });
    }

    const bytes = buildEscPosCommands(sampleVm());
    await sendEscPos(printer.host, printer.port || 9100, bytes);

    await prisma.printerProfile.update({
      where: { id: printer.id },
      data: { lastTestAt: new Date(), lastTestOk: true },
    });

    res.json({ success: true, message: 'Test print sent' });
  } catch (error) {
    await prisma.printerProfile.update({
      where: { id: req.params.id },
      data: { lastTestAt: new Date(), lastTestOk: false },
    }).catch(() => null);
    res.status(503).json({ error: error.message || 'Test print failed' });
  }
});

router.patch('/:id', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    const { name, type, format, host, port, isDefault, branchId } = req.body;
    if (isDefault) {
      await prisma.printerProfile.updateMany({ data: { isDefault: false } });
    }
    const printer = await prisma.printerProfile.update({
      where: { id: req.params.id },
      data: {
        ...(name != null && { name: String(name) }),
        ...(type != null && { type }),
        ...(format != null && { format }),
        ...(host !== undefined && { host: host || null }),
        ...(port != null && { port: Number(port) }),
        ...(isDefault != null && { isDefault: Boolean(isDefault) }),
        ...(branchId !== undefined && { branchId: branchId || null }),
      },
    });
    res.json(printer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update printer' });
  }
});

router.delete('/:id', authenticateToken, requirePermission('settings:write'), async (req, res) => {
  try {
    await prisma.printerProfile.delete({ where: { id: req.params.id } });
    res.json({ message: 'Printer deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete printer' });
  }
});

module.exports = router;
