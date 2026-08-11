/**
 * Receipt snapshots — immutable VM at fiscal completion.
 */

const prisma = require('../prisma');
const { buildReceiptViewModel } = require('@smartpos/receipt-engine');
const { saleInclude } = require('../saleFiscal');
const { refundInclude } = require('../saleRefund');
const { debitNoteInclude } = require('../saleDebitNote');
const {
  buildSaleReceiptSource,
  buildRefundReceiptSource,
  buildDebitNoteReceiptSource,
  loadBusinessContext,
} = require('./loaders');

const SOURCE_TYPE_MAP = {
  SALE: 'SALE',
  CREDIT_NOTE: 'CREDIT_NOTE',
  DEBIT_NOTE: 'DEBIT_NOTE',
};

async function buildViewModelForSale(saleId) {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      ...saleInclude,
      branch: true,
    },
  });
  if (!sale) {
    const err = new Error('Sale not found');
    err.status = 404;
    throw err;
  }
  const business = await loadBusinessContext();
  const source = await buildSaleReceiptSource(sale, business);
  return buildReceiptViewModel(source);
}

async function buildViewModelForRefund(refundId) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: {
      ...refundInclude,
      originalSale: { include: { branch: true } },
    },
  });
  if (!refund) {
    const err = new Error('Refund not found');
    err.status = 404;
    throw err;
  }
  const business = await loadBusinessContext();
  const source = await buildRefundReceiptSource(refund, business);
  return buildReceiptViewModel(source);
}

async function buildViewModelForDebitNote(debitNoteId) {
  const debitNote = await prisma.debitNote.findUnique({
    where: { id: debitNoteId },
    include: {
      ...debitNoteInclude,
      sale: {
        include: {
          saleItems: { include: { product: true } },
          customer: true,
          branch: true,
        },
      },
    },
  });
  if (!debitNote) {
    const err = new Error('Debit note not found');
    err.status = 404;
    throw err;
  }
  const business = await loadBusinessContext();
  const source = await buildDebitNoteReceiptSource(debitNote, business);
  return buildReceiptViewModel(source);
}

async function createSnapshotFromSource(sourceType, sourceId) {
  const prismaType = SOURCE_TYPE_MAP[sourceType];
  if (!prismaType) {
    throw new Error(`Invalid receipt source type: ${sourceType}`);
  }

  const vm =
    sourceType === 'SALE'
      ? await buildViewModelForSale(sourceId)
      : sourceType === 'DEBIT_NOTE'
      ? await buildViewModelForDebitNote(sourceId)
      : await buildViewModelForRefund(sourceId);

  const version = vm.receiptMeta.version || '1.0';

  await prisma.receiptSnapshot.upsert({
    where: {
      sourceType_sourceId: {
        sourceType: prismaType,
        sourceId,
      },
    },
    create: {
      sourceType: prismaType,
      sourceId,
      version,
      snapshot: vm,
      reprintCount: 0,
    },
    update: {
      version,
      snapshot: vm,
    },
  });

  return vm;
}

async function getSnapshot(sourceType, sourceId) {
  const prismaType = SOURCE_TYPE_MAP[sourceType];
  if (!prismaType) return null;
  return prisma.receiptSnapshot.findUnique({
    where: {
      sourceType_sourceId: {
        sourceType: prismaType,
        sourceId,
      },
    },
  });
}

async function getOrCreateSnapshot(sourceType, sourceId) {
  let row = await getSnapshot(sourceType, sourceId);
  if (row) return row.snapshot;

  if (sourceType === 'SALE') {
    const sale = await prisma.sale.findUnique({ where: { id: sourceId } });
    if (sale?.status === 'COMPLETED' && sale.rcptNo) {
      await createSnapshotFromSource('SALE', sourceId);
      row = await getSnapshot('SALE', sourceId);
      return row?.snapshot;
    }
  }

  if (sourceType === 'CREDIT_NOTE') {
    const refund = await prisma.refund.findUnique({ where: { id: sourceId } });
    if (refund?.status === 'COMPLETED' && refund.rcptNo) {
      await createSnapshotFromSource('CREDIT_NOTE', sourceId);
      row = await getSnapshot('CREDIT_NOTE', sourceId);
      return row?.snapshot;
    }
  }

  if (sourceType === 'DEBIT_NOTE') {
    const debitNote = await prisma.debitNote.findUnique({ where: { id: sourceId } });
    if (debitNote?.status === 'COMPLETED' && debitNote.rcptNo) {
      await createSnapshotFromSource('DEBIT_NOTE', sourceId);
      row = await getSnapshot('DEBIT_NOTE', sourceId);
      return row?.snapshot;
    }
  }

  return null;
}

async function recordReprint(sourceType, sourceId, { printedBy }) {
  const prismaType = SOURCE_TYPE_MAP[sourceType];
  if (!prismaType) {
    const err = new Error('Invalid receipt source type');
    err.status = 400;
    throw err;
  }

  let row = await getSnapshot(sourceType, sourceId);
  if (!row) {
    await createSnapshotFromSource(sourceType, sourceId);
    row = await getSnapshot(sourceType, sourceId);
  }
  if (!row) {
    const err = new Error('Receipt not available');
    err.status = 404;
    throw err;
  }

  const reprintCount = row.reprintCount + 1;
  const base = typeof row.snapshot === 'object' ? row.snapshot : row.snapshot;
  const vm = {
    ...base,
    receiptMeta: {
      ...base.receiptMeta,
      isCopy: true,
      reprintCount,
      printedAt: new Date().toISOString(),
      printedBy: printedBy || null,
    },
  };

  await prisma.receiptSnapshot.update({
    where: { id: row.id },
    data: { reprintCount },
  });

  return { vm, reprintCount };
}

module.exports = {
  createSnapshotFromSource,
  getOrCreateSnapshot,
  recordReprint,
  buildViewModelForSale,
  buildViewModelForRefund,
};
