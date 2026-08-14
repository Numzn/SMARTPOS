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
const { consumeApproval } = require('./approval');
const zraInvoiceService = require('../services/zraInvoice');
const vsdcService = require('../services/vsdcService');

const saleInclude = {
  user: { select: { id: true, name: true, email: true } },
  saleItems: { include: { product: true } },
  customer: true,
};

// Applied when a product has no maxDiscount set — a line discount above this
// percentage still requires manager approval rather than being unbounded.
const DEFAULT_DISCOUNT_APPROVAL_THRESHOLD_PERCENT = 10;

/**
 * Resolve a line's requested discount (either a flat amount or a percent of
 * that line's subtotal) to a clamped currency amount, and whether it exceeds
 * the product's approval threshold.
 */
function resolveLineDiscount(item, product, itemTotal) {
  const rawDiscount =
    item.discountAmount != null
      ? Number(item.discountAmount)
      : item.discountPercent != null
        ? (Number(item.discountPercent) / 100) * itemTotal
        : 0;

  const discount = Math.max(0, Math.min(Number.isFinite(rawDiscount) ? rawDiscount : 0, itemTotal));
  const effectivePercent = itemTotal > 0 ? (discount / itemTotal) * 100 : 0;
  const threshold =
    product.maxDiscount > 0 ? product.maxDiscount : DEFAULT_DISCOUNT_APPROVAL_THRESHOLD_PERCENT;

  return { discount, requiresApproval: discount > 0 && effectivePercent > threshold };
}

/**
 * A discount above the per-product (or default) threshold needs a supervisor
 * (or manager/admin) to sign off — via a short-lived, action-bound approval
 * ticket already minted through POST /api/till/approvals (lib/approval.js),
 * not a raw credential carried in the checkout payload itself. Consumed
 * inside the same transaction as the sale it authorizes.
 */
async function verifyDiscountApproval(tx, discountApprovalId, sessionId, discountAmount) {
  return consumeApproval(tx, discountApprovalId, {
    actionType: 'ORDER_DISCOUNT',
    sessionId,
    target: { discountAmount },
  });
}

function parseSalePayload(body) {
  const {
    userId,
    items,
    paymentMethod,
    tax,
    discount,
    branchId = DEFAULT_BRANCH,
    customerInfo,
    customerId,
    paymentDetails,
    tillSessionId,
    discountApprovalId,
  } = body;

  if (!userId || !Array.isArray(items) || items.length === 0) {
    const err = new Error('userId and items array are required');
    err.status = 400;
    throw err;
  }

  for (const item of items) {
    const qty = Number(item.quantity);
    const price = Number(item.price);
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Invalid quantity for product ${item.productId}`);
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(price) || price < 0) {
      const err = new Error(`Invalid price for product ${item.productId}`);
      err.status = 400;
      throw err;
    }
  }

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const taxAmount = tax || 0;
  const discountAmount = discount || 0;
  const total = subtotal + taxAmount - discountAmount;

  const customerName = customerInfo?.name?.trim() || null;
  const customerTpin = customerInfo?.tpin?.trim() || customerInfo?.taxId?.trim() || null;

  let amountPaid = null;
  let changeAmount = null;
  if (paymentDetails) {
    if (paymentDetails.cashReceived != null) {
      amountPaid = parseFloat(paymentDetails.cashReceived);
    }
    if (paymentDetails.change != null) {
      changeAmount = parseFloat(paymentDetails.change);
    }
  }

  return {
    userId,
    items,
    paymentMethod: paymentMethod || 'CASH',
    branchId,
    subtotal,
    taxAmount,
    discountAmount,
    total,
    customerName,
    customerTpin,
    customerId: customerId || null,
    amountPaid: Number.isFinite(amountPaid) ? amountPaid : null,
    changeAmount: Number.isFinite(changeAmount) ? changeAmount : null,
    tillSessionId: tillSessionId || null,
    discountApprovalId: discountApprovalId || null,
  };
}

/**
 * Row-locks the till session, verifies the requesting user owns it and it's
 * still OPEN, and validates the submitted items exactly match its committed
 * ACTIVE lines (same products, quantities, prices) — the real enforcement
 * behind "the cart can't change after the customer sees a total": even a
 * hand-crafted checkout request can't submit anything the server didn't
 * already record as scanned. Must run inside the same transaction as the
 * Sale it authorizes.
 */
async function validateAndLockTillSession(tx, sessionId, userId, items) {
  const locked = await tx.$queryRaw`SELECT id FROM cashier_cart_sessions WHERE id = ${sessionId} FOR UPDATE`;
  if (!locked.length) {
    const err = new Error('Till session not found');
    err.status = 404;
    throw err;
  }

  const session = await tx.cashierCartSession.findUnique({ where: { id: sessionId } });
  if (session.userId !== userId) {
    const err = new Error('You do not own this till session');
    err.status = 403;
    throw err;
  }
  if (session.status !== 'OPEN') {
    const err = new Error(`Till session is ${session.status.toLowerCase()}, not open`);
    err.status = 409;
    throw err;
  }

  const activeLines = await tx.cashierCartLine.findMany({ where: { sessionId, status: 'ACTIVE' } });

  const submitted = new Map(
    items.map((item) => [item.productId, { quantity: parseInt(item.quantity, 10), price: parseFloat(item.price) }])
  );
  const committed = new Map(activeLines.map((line) => [line.productId, line]));

  const mismatchError = () => {
    const err = new Error(
      'Submitted cart does not match the till session\'s committed items — it may be stale or tampered with'
    );
    err.status = 409;
    return err;
  };

  if (submitted.size !== committed.size) throw mismatchError();
  for (const [productId, sub] of submitted) {
    const line = committed.get(productId);
    if (!line || line.quantity !== sub.quantity || Math.abs(line.unitPrice - sub.price) > 0.01) {
      throw mismatchError();
    }
  }

  return session;
}

async function createPendingSale(body) {
  const parsed = parseSalePayload(body);

  return prisma.$transaction(async (tx) => {
    const branchId = parsed.branchId || DEFAULT_BRANCH;

    // Till-lock validation — see validateAndLockTillSession's own comment.
    // Optional: bare/admin sale creation that never opened a till session is
    // unaffected, unchanged from before this feature existed.
    if (parsed.tillSessionId) {
      await validateAndLockTillSession(tx, parsed.tillSessionId, parsed.userId, parsed.items);
    }

    const openShift = await tx.shift.findFirst({
      where: { userId: parsed.userId, branchId, status: 'OPEN' },
    });

    // A registered customer is optional and explicitly selected — walk-in
    // sales (no customerId) are completely unaffected. When present, its
    // name/tpin only fill in what customerInfo didn't already override, and
    // the sale snapshots them at creation time (same "don't live-join"
    // principle as ReceiptSnapshot — a later edit to the Customer record
    // never retroactively changes a past receipt).
    let customer = null;
    if (parsed.customerId) {
      customer = await tx.customer.findUnique({ where: { id: parsed.customerId } });
      if (!customer || !customer.isActive) {
        const err = new Error('Selected customer not found or inactive');
        err.status = 400;
        throw err;
      }
    }
    const resolvedCustomerName = parsed.customerName || customer?.name || null;
    const resolvedCustomerTpin = parsed.customerTpin || customer?.tpin || null;

    // Resolve each line's discount and whether any of them (or the
    // order-level discount) crosses the approval threshold, before creating
    // any rows — an approval failure must not leave a half-written sale.
    const lineResolutions = [];
    let totalLineDiscount = 0;
    let approvalRequired = false;

    for (const item of parsed.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const quantity = parseInt(item.quantity, 10);
      const unitPrice = parseFloat(item.price);
      const itemTotal = quantity * unitPrice;
      const { discount: lineDiscount, requiresApproval } = resolveLineDiscount(item, product, itemTotal);

      if (requiresApproval) approvalRequired = true;
      totalLineDiscount += lineDiscount;
      lineResolutions.push({ item, product, quantity, unitPrice, itemTotal, lineDiscount });
    }

    const orderLevelDiscount = parseFloat(parsed.discountAmount) || 0;
    const combinedDiscount = totalLineDiscount + orderLevelDiscount;

    // The order-level (cart-wide) discount needs the same approval gate as a
    // per-line discount — previously only per-line discounts (a field the
    // shipped cashier UI never sends) were checked here, so a 100% cart
    // discount went through with zero approval. See CartSection.jsx/
    // cartTotals.js for where this value actually comes from.
    const orderLevelPercent = parsed.subtotal > 0 ? (orderLevelDiscount / parsed.subtotal) * 100 : 0;
    if (orderLevelDiscount > 0 && orderLevelPercent > DEFAULT_DISCOUNT_APPROVAL_THRESHOLD_PERCENT) {
      approvalRequired = true;
    }

    let approvedByUserId = null;
    if (approvalRequired) {
      const approver = await verifyDiscountApproval(tx, parsed.discountApprovalId, parsed.tillSessionId, combinedDiscount);
      approvedByUserId = approver.id;
    }

    const newSale = await tx.sale.create({
      data: {
        userId: parsed.userId,
        total: parseFloat(parsed.subtotal) + parseFloat(parsed.taxAmount) - combinedDiscount,
        subtotal: parseFloat(parsed.subtotal),
        tax: parseFloat(parsed.taxAmount),
        discount: combinedDiscount,
        discountApprovedByUserId: approvedByUserId,
        paymentMethod: parsed.paymentMethod,
        status: 'PENDING',
        shiftId: openShift?.id,
        branchId,
        customerName: resolvedCustomerName,
        customerTpin: resolvedCustomerTpin,
        customerId: parsed.customerId,
        amountPaid: parsed.amountPaid,
        changeAmount: parsed.changeAmount,
      },
    });

    for (const { item, product, quantity, unitPrice, itemTotal, lineDiscount } of lineResolutions) {
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
          discount: lineDiscount,
          pkg: 1,
          qty: quantity,
          prc: unitPrice,
          splyAmt,
          taxblAmt,
          taxAmt,
          totAmt,
          itemClsCd: product.zraItemClassification || product.zraClassificationCode || null,
          taxType: product.taxType || null,
        },
      });
    }

    if (parsed.tillSessionId) {
      await tx.cashierCartSession.update({
        where: { id: parsed.tillSessionId },
        data: { status: 'CONSUMED' },
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

function extractZraFromVsdcPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  if (!data.rcptNo) return null;
  return {
    rcptNo: data.rcptNo,
    qrCode: data.qrCode,
    // Distinct VSDC fields — a missing one must read as missing, not silently
    // backfilled from the other (that conflation is the bug A2 fixes).
    intrlData: data.intrlData ?? null,
    rcptSign: data.rcptSign ?? null,
    vsdcRcptPbctDate: data.vsdcRcptPbctDate ?? null,
  };
}

function parseVsdcDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Complete sale after confirmed VSDC success (used by checkout and reconciliation).
 *
 * The status flip to COMPLETED (an irreversible, fiscally-signed receipt) and the
 * stock deduction it implies MUST commit or fail together — otherwise a crash
 * between the two leaves a fiscally completed sale with stock never deducted,
 * and no reconciliation path scans COMPLETED sales for that drift. Both writes
 * therefore run against the same `tx`, inside one transaction.
 */
async function completeSaleAfterFiscalSuccess(saleId, zra, fiscalPayload = {}, branchId = DEFAULT_BRANCH) {
  const sale = await prisma.$transaction(async (tx) => {
    const updated = await tx.sale.update({
      where: { id: saleId },
      data: {
        status: 'COMPLETED',
        rcptNo: zra.rcptNo,
        rcptSign: zra.rcptSign ?? null,
        intrlData: zra.intrlData ?? null,
        qrCode: zra.qrCode,
        vsdcTimestamp: new Date(),
        vsdcRcptPbctDate: parseVsdcDate(zra.vsdcRcptPbctDate),
        vsdcRequest: fiscalPayload.vsdcRequest ?? undefined,
        vsdcResponse: fiscalPayload.vsdcResponse ?? undefined,
        fiscalError: null,
        fiscalErrorCode: null,
      },
      include: saleInclude,
    });

    const existingMovement = await tx.stockMovement.findFirst({
      where: {
        referenceType: 'SALE',
        referenceId: updated.id,
        movementType: 'SALE_OUT',
      },
    });

    if (!existingMovement) {
      for (const item of updated.saleItems) {
        await deductStockForSale(tx, {
          productId: item.productId,
          quantity: item.quantity,
          branchId,
          userId: updated.userId,
          saleId: updated.id,
        });
      }
    }

    return updated;
  });

  const stockSyncService = require('../services/stockSyncService');
  stockSyncService.syncAfterSale(sale.id, branchId);

  try {
    const { createSnapshotFromSource } = require('./receipt/snapshot');
    await createSnapshotFromSource('SALE', saleId);
  } catch (snapErr) {
    console.warn('[saleFiscal] receipt snapshot failed:', snapErr.message);
  }

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
        fiscalErrorCode: fiscalResult.code || null,
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
        code: failed.fiscalErrorCode,
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
};
