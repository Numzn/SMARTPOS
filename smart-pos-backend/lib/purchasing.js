/**
 * Purchase Order lifecycle: draft -> send -> receive (fully or in parts,
 * across multiple GoodsReceivedNotes) -> RECEIVED, or cancel before any
 * receiving happens. Non-fiscal business documents — no VSDC involvement.
 */

const prisma = require('./prisma');
const { DEFAULT_BRANCH } = require('./inventoryStock');
const { receiveStock } = require('./receiving');
const { nextSequentialNumber } = require('./sequentialNumber');

const poInclude = {
  supplier: true,
  items: { include: { product: { select: { id: true, name: true, sku: true } } } },
};

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('At least one item is required');
    err.status = 400;
    throw err;
  }
  for (const item of items) {
    const qty = Number(item.quantity);
    const cost = Number(item.unitCost);
    if (!item.productId) {
      const err = new Error('Each item requires a productId');
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Invalid quantity for product ${item.productId}`);
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      const err = new Error(`Invalid unitCost for product ${item.productId}`);
      err.status = 400;
      throw err;
    }
  }
}

// Receive-line shape is {purchaseOrderItemId, quantity, unitCost?, expiryDate?}
// — distinct from validateItems' {productId, quantity, unitCost} PO-line
// shape, since the product/cost are looked up from the PO line itself.
function validateReceiveItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('At least one item is required');
    err.status = 400;
    throw err;
  }
  for (const item of items) {
    const qty = Number(item.quantity);
    if (!item.purchaseOrderItemId) {
      const err = new Error('Each item requires a purchaseOrderItemId');
      err.status = 400;
      throw err;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Invalid quantity for line ${item.purchaseOrderItemId}`);
      err.status = 400;
      throw err;
    }
  }
}

async function createDraftPurchaseOrder({ supplierId, branchId = DEFAULT_BRANCH, items, expectedDate, notes, userId }) {
  if (!supplierId) {
    const err = new Error('supplierId is required');
    err.status = 400;
    throw err;
  }
  validateItems(items);

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || !supplier.isActive) {
      const err = new Error('Supplier not found or inactive');
      err.status = 400;
      throw err;
    }

    const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
    const poNumber = await nextSequentialNumber(tx, {
      model: 'purchaseOrder',
      field: 'poNumber',
      prefix: 'PO',
    });

    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId,
        branchId,
        status: 'DRAFT',
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes: notes || null,
        subtotal,
        total: subtotal,
        createdBy: userId || null,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantityOrdered: parseInt(item.quantity, 10),
            unitCost: Number(item.unitCost),
            total: Number(item.quantity) * Number(item.unitCost),
          })),
        },
      },
      include: poInclude,
    });

    return po;
  });
}

async function updateDraftPurchaseOrder(poId, { supplierId, expectedDate, notes, items }, userId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id: poId } });
    if (!existing) {
      const err = new Error('Purchase order not found');
      err.status = 404;
      throw err;
    }
    if (existing.status !== 'DRAFT') {
      const err = new Error('Only DRAFT purchase orders can be edited');
      err.status = 409;
      throw err;
    }

    const data = { updatedBy: userId || null };
    if (supplierId !== undefined) data.supplierId = supplierId;
    if (expectedDate !== undefined) data.expectedDate = expectedDate ? new Date(expectedDate) : null;
    if (notes !== undefined) data.notes = notes;

    if (items !== undefined) {
      validateItems(items);
      const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0);
      data.subtotal = subtotal;
      data.total = subtotal;
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: poId } });
      await tx.purchaseOrderItem.createMany({
        data: items.map((item) => ({
          purchaseOrderId: poId,
          productId: item.productId,
          quantityOrdered: parseInt(item.quantity, 10),
          unitCost: Number(item.unitCost),
          total: Number(item.quantity) * Number(item.unitCost),
        })),
      });
    }

    await tx.purchaseOrder.update({ where: { id: poId }, data });
    return tx.purchaseOrder.findUnique({ where: { id: poId }, include: poInclude });
  });
}

async function sendPurchaseOrder(poId, userId) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po) {
    const err = new Error('Purchase order not found');
    err.status = 404;
    throw err;
  }
  if (po.status !== 'DRAFT') {
    const err = new Error(`Cannot send a purchase order in status ${po.status}`);
    err.status = 409;
    throw err;
  }

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: 'SENT', updatedBy: userId || null },
    include: poInclude,
  });
}

async function cancelPurchaseOrder(poId, userId) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    if (!po) {
      const err = new Error('Purchase order not found');
      err.status = 404;
      throw err;
    }
    if (!['DRAFT', 'SENT'].includes(po.status)) {
      const err = new Error(`Cannot cancel a purchase order in status ${po.status}`);
      err.status = 409;
      throw err;
    }
    if (po.items.some((item) => item.quantityReceived > 0)) {
      const err = new Error('Cannot cancel a purchase order that has already received stock — use a supplier return instead');
      err.status = 409;
      throw err;
    }

    return tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: userId || null },
      include: poInclude,
    });
  });
}

/**
 * RECEIVED if every line is fully received, PARTIALLY_RECEIVED if any line
 * has partial progress, otherwise left as-is (SENT). Called inside the
 * caller's own transaction so it sees the just-updated quantityReceived rows.
 */
async function recomputePoStatus(tx, purchaseOrderId) {
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId } });
  const allReceived = items.every((item) => item.quantityReceived >= item.quantityOrdered);
  const anyReceived = items.some((item) => item.quantityReceived > 0);

  const status = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : undefined;
  if (!status) return;

  await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } });
}

/**
 * Receive stock against a PO — creates one GoodsReceivedNote covering the
 * lines received in this delivery. Supports partial receipt: call this again
 * for a later delivery against the same PO, quantityReceived accumulates.
 */
async function receiveAgainstPurchaseOrder(poId, { items, branchId = DEFAULT_BRANCH, userId, notes, receivedDate }) {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }
  validateReceiveItems(items);

  return prisma.$transaction(async (tx) => {
    // Row-lock the PO so two concurrent receives against the same PO can't
    // both read stale quantityReceived values and both "succeed" past the
    // over-receipt guard below.
    const locked = await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${poId} FOR UPDATE`;
    if (!locked.length) {
      const err = new Error('Purchase order not found');
      err.status = 404;
      throw err;
    }

    const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    if (!['SENT', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      const err = new Error(`Cannot receive against a purchase order in status ${po.status}`);
      err.status = 409;
      throw err;
    }

    const poItemsById = new Map(po.items.map((item) => [item.id, item]));

    for (const line of items) {
      const poItem = poItemsById.get(line.purchaseOrderItemId);
      if (!poItem) {
        const err = new Error(`Purchase order line not found: ${line.purchaseOrderItemId}`);
        err.status = 400;
        throw err;
      }
      const remaining = poItem.quantityOrdered - poItem.quantityReceived;
      if (Number(line.quantity) > remaining) {
        const err = new Error(
          `Cannot receive ${line.quantity} of ${poItem.productId}: only ${remaining} remaining on this order`
        );
        err.status = 409;
        throw err;
      }
    }

    const grnNumber = await nextSequentialNumber(tx, {
      model: 'goodsReceivedNote',
      field: 'grnNumber',
      prefix: 'GRN',
    });

    const grn = await tx.goodsReceivedNote.create({
      data: {
        grnNumber,
        purchaseOrderId: poId,
        supplierId: po.supplierId,
        branchId,
        receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
        notes: notes || null,
        receivedBy: userId || null,
      },
    });

    for (const line of items) {
      const poItem = poItemsById.get(line.purchaseOrderItemId);
      const quantity = parseInt(line.quantity, 10);
      const unitCost = line.unitCost != null ? Number(line.unitCost) : poItem.unitCost;

      const { inventoryBatch } = await receiveStock(tx, {
        productId: poItem.productId,
        quantity,
        unitCost,
        branchId,
        supplierInfo: po.supplier?.name,
        supplierId: po.supplierId,
        expiryDate: line.expiryDate,
        receivedDate,
        userId,
        referenceType: 'PURCHASE_ORDER',
        referenceId: grn.id,
      });

      await tx.goodsReceivedNoteItem.create({
        data: {
          goodsReceivedNoteId: grn.id,
          purchaseOrderItemId: poItem.id,
          productId: poItem.productId,
          quantityReceived: quantity,
          unitCost,
          batchId: inventoryBatch.id,
        },
      });

      await tx.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: { quantityReceived: { increment: quantity } },
      });
    }

    await recomputePoStatus(tx, poId);

    return {
      grn: await tx.goodsReceivedNote.findUnique({
        where: { id: grn.id },
        include: { items: true, supplier: true },
      }),
      purchaseOrder: await tx.purchaseOrder.findUnique({ where: { id: poId }, include: poInclude }),
    };
  });
}

module.exports = {
  poInclude,
  createDraftPurchaseOrder,
  updateDraftPurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  recomputePoStatus,
  receiveAgainstPurchaseOrder,
};
