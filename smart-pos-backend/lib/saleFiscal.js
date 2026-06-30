/**
 * Fiscal sale lifecycle — PENDING → VSDC → COMPLETED + stock deduct.
 * Reference: NUMZPAY GRC FP-001 (fiscal lock).
 */

const prisma = require('./prisma');
const {
  deductStockForSale,
  assertSufficientStock,
  reserveStockForSale,
  releaseStockReservationForSale,
  DEFAULT_BRANCH,
} = require('./inventoryStock');
const { assertRegisteredProducts } = require('./productRegistration');
const zraInvoiceService = require('../services/zraInvoice');
const vsdcService = require('../services/vsdcService');

const saleInclude = {
  user: { select: { id: true, name: true, email: true } },
  saleItems: { include: { product: true } },
};

function parseSalePayload(body) {
  const { userId, items, paymentMethod, tax, discount, branchId = DEFAULT_BRANCH } = body;

  if (!userId || !Array.isArray(items) || items.length === 0) {
    const err = new Error('userId and items array are required');
    err.status = 400;
    throw err;
  }

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const taxAmount = tax || 0;
  const discountAmount = discount || 0;
  const total = subtotal + taxAmount - discountAmount;

  return {
    userId,
    items,
    paymentMethod: paymentMethod || 'CASH',
    branchId,
    subtotal,
    taxAmount,
    discountAmount,
    total,
  };
}

async function createPendingSale(body) {
  const parsed = parseSalePayload(body);

  return prisma.$transaction(async (tx) => {
    const newSale = await tx.sale.create({
      data: {
        userId: parsed.userId,
        total: parseFloat(parsed.total),
        subtotal: parseFloat(parsed.subtotal),
        tax: parseFloat(parsed.taxAmount),
        discount: parseFloat(parsed.discountAmount),
        paymentMethod: parsed.paymentMethod,
        status: 'PENDING',
        branchId: parsed.branchId || DEFAULT_BRANCH,
      },
    });

    for (const item of parsed.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const quantity = parseInt(item.quantity, 10);
      const unitPrice = parseFloat(item.price);
      const itemTotal = quantity * unitPrice;
      const taxRate = (product.taxRate ?? 16) / 100;
      const splyAmt = itemTotal;
      const taxblAmt = splyAmt;
      const taxAmt = taxblAmt * taxRate;
      const totAmt = splyAmt + taxAmt;

      await tx.saleItem.create({
        data: {
          saleId: newSale.id,
          productId: item.productId,
          quantity,
          price: unitPrice,
          total: itemTotal,
          pkg: 1,
          qty: quantity,
          prc: unitPrice,
          splyAmt,
          taxblAmt,
          taxAmt,
          totAmt,
        },
      });
    }

    return tx.sale.findUnique({
      where: { id: newSale.id },
      include: saleInclude,
    });
  });
}

async function reserveStockForSaleRecord(sale, branchId = DEFAULT_BRANCH) {
  await prisma.$transaction(async (tx) => {
    for (const item of sale.saleItems) {
      await reserveStockForSale(tx, {
        productId: item.productId,
        quantity: item.quantity,
        branchId,
      });
    }
  });
}

async function deductStockForSaleRecord(sale, branchId = DEFAULT_BRANCH) {
  await prisma.$transaction(async (tx) => {
    for (const item of sale.saleItems) {
      await deductStockForSale(tx, {
        productId: item.productId,
        quantity: item.quantity,
        branchId,
        userId: sale.userId,
        saleId: sale.id,
      });
    }
  });
}

function extractZraFromVsdcPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data.rcptNo) return null;
  return {
    rcptNo: data.rcptNo,
    qrCode: data.qrCode,
    intrlData: data.intrlData || data.rcptSign,
    rcptSign: data.rcptSign || data.intrlData,
  };
}

/**
 * Complete sale after confirmed VSDC success (used by checkout and reconciliation).
 */
async function completeSaleAfterFiscalSuccess(saleId, zra, fiscalPayload = {}, branchId = DEFAULT_BRANCH) {
  let sale = await prisma.sale.update({
    where: { id: saleId },
    data: {
      status: 'COMPLETED',
      rcptNo: zra.rcptNo,
      rcptSign: zra.intrlData || zra.rcptSign,
      qrCode: zra.qrCode,
      vsdcTimestamp: new Date(),
      vsdcRequest: fiscalPayload.vsdcRequest ?? undefined,
      vsdcResponse: fiscalPayload.vsdcResponse ?? undefined,
      fiscalError: null,
    },
    include: saleInclude,
  });

  const existingMovement = await prisma.stockMovement.findFirst({
    where: {
      referenceType: 'SALE',
      referenceId: sale.id,
      movementType: 'SALE_OUT',
    },
  });

  if (!existingMovement) {
    await deductStockForSaleRecord(sale, branchId);
  }

  const stockSyncService = require('../services/stockSyncService');
  stockSyncService.syncAfterSale(sale.id, branchId);

  return sale;
}

/**
 * Submit sale to VSDC and complete or mark fiscal failure.
 * Stock is reserved before VSDC and deducted only after VSDC success.
 */
async function finalizeSaleFiscally(saleId, { branchId = DEFAULT_BRANCH } = {}) {
  const ready = await vsdcService.isDeviceReady();
  if (!ready) {
    const init = await vsdcService.ensureDeviceInitialized();
    if (!init.success) {
      const err = new Error(init.error || 'VSDC device not initialized');
      err.status = 503;
      throw err;
    }
  }

  let sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: saleInclude,
  });

  if (!sale) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }

  if (sale.status === 'COMPLETED' && sale.rcptNo) {
    return {
      success: true,
      sale,
      fiscal: {
        success: true,
        rcptNo: sale.rcptNo,
        qrCode: sale.qrCode,
      },
    };
  }

  if (!['PENDING', 'FISCAL_FAILED', 'FISCAL_SUBMITTING'].includes(sale.status)) {
    const err = new Error(`Sale cannot be fiscalized in status ${sale.status}`);
    err.status = 400;
    throw err;
  }

  try {
    await assertRegisteredProducts(
      sale.saleItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
    );
  } catch (regErr) {
    const failed = await prisma.sale.update({
      where: { id: saleId },
      data: {
        status: 'FISCAL_FAILED',
        fiscalError: regErr.message || 'Product not registered with ZRA',
      },
      include: saleInclude,
    });
    regErr.status = regErr.status || 409;
    return {
      success: false,
      sale: failed,
      fiscal: { success: false, error: failed.fiscalError },
    };
  }

  if (['PENDING', 'FISCAL_FAILED'].includes(sale.status)) {
    try {
      await reserveStockForSaleRecord(sale, branchId);
    } catch (reserveErr) {
      const failed = await prisma.sale.update({
        where: { id: saleId },
        data: {
          status: 'FISCAL_FAILED',
          fiscalError: reserveErr.message || 'Insufficient stock to reserve',
        },
        include: saleInclude,
      });
      reserveErr.status = reserveErr.status || 409;
      return {
        success: false,
        sale: failed,
        fiscal: { success: false, error: failed.fiscalError },
      };
    }
  }

  await prisma.sale.update({
    where: { id: saleId },
    data: { status: 'FISCAL_SUBMITTING', fiscalError: null },
  });

  const fiscalResult = await zraInvoiceService.submitFiscalForSale(saleId);

  if (!fiscalResult.success) {
    await prisma.$transaction(async (tx) => {
      await releaseStockReservationForSale(tx, sale, branchId);
    });

    const failed = await prisma.sale.update({
      where: { id: saleId },
      data: {
        status: 'FISCAL_FAILED',
        fiscalError: fiscalResult.message || fiscalResult.error || 'ZRA submission failed',
        vsdcRequest: fiscalResult.vsdcRequest ?? undefined,
        vsdcResponse: fiscalResult.vsdcResponse ?? undefined,
      },
      include: saleInclude,
    });

    return {
      success: false,
      sale: failed,
      fiscal: {
        success: false,
        error: failed.fiscalError,
      },
    };
  }

  const zra = fiscalResult.zraResponse;
  sale = await completeSaleAfterFiscalSuccess(
    saleId,
    zra,
    {
      vsdcRequest: fiscalResult.vsdcRequest,
      vsdcResponse: fiscalResult.vsdcResponse,
    },
    branchId
  );

  return {
    success: true,
    sale,
    fiscal: {
      success: true,
      rcptNo: sale.rcptNo,
      qrCode: sale.qrCode,
      receiptNumber: sale.rcptNo,
    },
  };
}

/**
 * Create a PENDING sale only after stock + registration gates (no VSDC/stock deduct).
 */
async function createGatedPendingSale(body) {
  const branchId = body.branchId || DEFAULT_BRANCH;
  const parsed = parseSalePayload(body);
  await assertSufficientStock(parsed.items, branchId);
  await assertRegisteredProducts(parsed.items);
  return createPendingSale(body);
}

async function checkoutSale(body) {
  const branchId = body.branchId || DEFAULT_BRANCH;
  const pending = await createGatedPendingSale(body);
  return finalizeSaleFiscally(pending.id, { branchId });
}

module.exports = {
  parseSalePayload,
  createPendingSale,
  createGatedPendingSale,
  finalizeSaleFiscally,
  completeSaleAfterFiscalSuccess,
  extractZraFromVsdcPayload,
  checkoutSale,
  saleInclude,
  reserveStockForSaleRecord,
  releaseStockReservationForSale,
  deductStockForSaleRecord,
};
