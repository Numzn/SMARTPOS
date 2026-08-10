import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import testData from '../helpers/testData.js';

// Loaded via require() (not import) because these are CJS singletons also
// required by other CJS application modules under test — mixing import/require
// for the same singleton causes vite-node and Node's require cache to each
// instantiate their own copy, silently breaking vi.spyOn (see vsdcOfficialRouting
// and vsdcSubmitValidation unit tests for the same pattern).
const saleFiscal = require('../../lib/saleFiscal.js');
const vsdcGateway = require('../../lib/vsdc-gateway/index.js');
const vsdcService = require('../../services/vsdcService.js');

const {
  prisma,
  createTestBranch,
  createTestUser,
  createTestProduct,
  createTestInventory,
  createTestBatch,
  cleanupTestData,
  DEFAULT_BRANCH_CODE,
} = testData;

async function createClassifiedSellableProduct({ stock = 10 } = {}) {
  const product = await createTestProduct({
    zraItemClassification: '50101500',
    zraRegistrationStatus: 'REGISTERED',
  });
  await createTestInventory(product.id, { currentStock: stock });
  await createTestBatch(product.id, { quantity: stock });
  return product;
}

async function createFiscalizableSale(user, product) {
  return prisma.sale.create({
    data: {
      userId: user.id,
      branchId: DEFAULT_BRANCH_CODE,
      total: 116,
      subtotal: 100,
      tax: 16,
      discount: 0,
      paymentMethod: 'CASH',
      status: 'FISCAL_SUBMITTING',
      saleItems: {
        create: [
          {
            productId: product.id,
            quantity: 1,
            price: 100,
            total: 100,
            pkg: 1,
            qty: 1,
            prc: 100,
            splyAmt: 100,
            taxblAmt: 100,
            taxAmt: 16,
            totAmt: 116,
          },
        ],
      },
    },
    include: { saleItems: true },
  });
}

describe('zraInvoiceService fiscal-error-code preservation and duplicate-invoice recovery (A4)', () => {
  const originalTpin = vsdcService.tpin;
  const originalBhfId = vsdcService.bhfId;

  beforeAll(async () => {
    await createTestBranch();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vsdcService.tpin = originalTpin;
    vsdcService.bhfId = originalBhfId;
    await cleanupTestData();
  });

  it('REGRESSION: persists the ZRA resultCd as fiscalErrorCode instead of discarding it behind a generic message', async () => {
    const user = await createTestUser();
    const product = await createClassifiedSellableProduct();
    const sale = await createFiscalizableSale(user, product);

    vsdcService.tpin = 'TEST-TPIN';
    vsdcService.bhfId = '000';
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    vi.spyOn(vsdcGateway, 'submitInvoiceData').mockResolvedValue({
      success: false,
      error: 'Invalid TPIN supplied',
      code: '026',
    });

    const result = await saleFiscal.finalizeSaleFiscally(sale.id);

    expect(result.success).toBe(false);
    expect(result.sale.status).toBe('FISCAL_FAILED');
    expect(result.sale.fiscalErrorCode).toBe('026');
    expect(result.sale.fiscalError).toBe('Invalid TPIN supplied');
  });

  it('REGRESSION: recovers a resultCd 007 duplicate-invoice submission as fiscal success instead of failing the sale', async () => {
    const user = await createTestUser();
    const product = await createClassifiedSellableProduct();
    const sale = await createFiscalizableSale(user, product);

    vsdcService.tpin = 'TEST-TPIN';
    vsdcService.bhfId = '000';
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    vi.spyOn(vsdcGateway, 'submitInvoiceData').mockResolvedValue({
      success: false,
      error: 'Invoice already exists',
      code: '007',
    });
    vi.spyOn(vsdcGateway, 'lookupInvoice').mockResolvedValue({
      success: true,
      data: {
        resultCd: '000',
        rcptNo: 'DUP-RCPT-1',
        qrCode: 'DUP-QR-1',
        rcptSign: 'DUP-SIGN-1',
        intrlData: 'DUP-INTRL-1',
      },
    });

    const result = await saleFiscal.finalizeSaleFiscally(sale.id);

    expect(result.success).toBe(true);
    expect(result.sale.status).toBe('COMPLETED');
    expect(result.sale.rcptNo).toBe('DUP-RCPT-1');
    expect(result.sale.rcptSign).toBe('DUP-SIGN-1');
    expect(result.sale.intrlData).toBe('DUP-INTRL-1');
  });

  it('falls back to FISCAL_FAILED when a resultCd 007 cannot be recovered (lookup also fails)', async () => {
    const user = await createTestUser();
    const product = await createClassifiedSellableProduct();
    const sale = await createFiscalizableSale(user, product);

    vsdcService.tpin = 'TEST-TPIN';
    vsdcService.bhfId = '000';
    vi.spyOn(vsdcService, 'isDeviceReady').mockResolvedValue(true);
    vi.spyOn(vsdcGateway, 'submitInvoiceData').mockResolvedValue({
      success: false,
      error: 'Invoice already exists',
      code: '007',
    });
    vi.spyOn(vsdcGateway, 'lookupInvoice').mockResolvedValue({ success: false });

    const result = await saleFiscal.finalizeSaleFiscally(sale.id);

    expect(result.success).toBe(false);
    expect(result.sale.status).toBe('FISCAL_FAILED');
    expect(result.sale.fiscalErrorCode).toBe('007');
  });
});
