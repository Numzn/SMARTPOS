import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import { extractSignaturePair, backfill } from '../../scripts/backfill-fiscal-signatures.js';

const { prisma, createTestBranch, createTestUser, createSellableProduct, createTestSale, cleanupTestData } =
  testData;

describe('extractSignaturePair', () => {
  it('recovers the distinct rcptSign/intrlData pair from a nested { data: {...} } vsdcResponse', () => {
    const pair = extractSignaturePair({
      data: { rcptSign: 'REAL-SIGN', intrlData: 'REAL-INTRL' },
    });
    expect(pair).toEqual({ rcptSign: 'REAL-SIGN', intrlData: 'REAL-INTRL' });
  });

  it('recovers from a flat vsdcResponse', () => {
    const pair = extractSignaturePair({ rcptSign: 'REAL-SIGN', intrlData: 'REAL-INTRL' });
    expect(pair).toEqual({ rcptSign: 'REAL-SIGN', intrlData: 'REAL-INTRL' });
  });

  it('returns null when there is no recoverable rcptSign', () => {
    expect(extractSignaturePair(null)).toBeNull();
    expect(extractSignaturePair({})).toBeNull();
    expect(extractSignaturePair({ data: { foo: 'bar' } })).toBeNull();
  });
});

describe('backfill (recovering historical rows conflated by the pre-A2 bug)', () => {
  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('REGRESSION: dry run reports a recoverable row without writing it', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 1, price: 100 });

    // Simulate the pre-A2 bug: rcptSign holds what was actually intrlData,
    // intrlData column is empty, but vsdcResponse retains the true pair.
    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        rcptSign: 'REAL-INTRL',
        intrlData: null,
        vsdcResponse: { rcptSign: 'REAL-SIGN', intrlData: 'REAL-INTRL', rcptNo: 'RCPT-X' },
      },
    });

    const result = await backfill(prisma.sale, 'Sale', false);
    expect(result.recovered).toBe(1);
    expect(result.unrecoverable).toBe(0);

    const reloaded = await prisma.sale.findUnique({ where: { id: sale.id } });
    expect(reloaded.rcptSign).toBe('REAL-INTRL'); // untouched by dry run
    expect(reloaded.intrlData).toBeNull();
  });

  it('REGRESSION: --apply writes the recovered rcptSign/intrlData pair', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 1, price: 100 });

    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        rcptSign: 'REAL-INTRL',
        intrlData: null,
        vsdcResponse: { rcptSign: 'REAL-SIGN', intrlData: 'REAL-INTRL', rcptNo: 'RCPT-X' },
      },
    });

    const result = await backfill(prisma.sale, 'Sale', true);
    expect(result.recovered).toBe(1);

    const reloaded = await prisma.sale.findUnique({ where: { id: sale.id } });
    expect(reloaded.rcptSign).toBe('REAL-SIGN');
    expect(reloaded.intrlData).toBe('REAL-INTRL');
  });

  it('leaves a row untouched and counts it unrecoverable when vsdcResponse has no rcptSign', async () => {
    const user = await createTestUser();
    const product = await createSellableProduct({ stock: 10 });
    const sale = await createTestSale({ userId: user.id, productId: product.id, quantity: 1, price: 100 });

    await prisma.sale.update({
      where: { id: sale.id },
      data: { rcptSign: 'STALE-VALUE', intrlData: null, vsdcResponse: { rcptNo: 'RCPT-Y' } },
    });

    const result = await backfill(prisma.sale, 'Sale', true);
    expect(result.unrecoverable).toBe(1);
    expect(result.recovered).toBe(0);

    const reloaded = await prisma.sale.findUnique({ where: { id: sale.id } });
    expect(reloaded.rcptSign).toBe('STALE-VALUE');
  });
});
