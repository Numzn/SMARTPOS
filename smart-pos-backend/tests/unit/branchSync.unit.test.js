import { describe, it, expect, vi, afterEach } from 'vitest';

const prisma = require('../../lib/prisma');
const transport = require('../../lib/vsdc-gateway/transport');
const endpointAdapter = require('../../lib/vsdc-gateway/endpointAdapter');
const branchSync = require('../../lib/vsdc-gateway/branchSync');
const testData = require('../helpers/testData.js');

const { createTestBranch, createTestCustomer, createTestUser, cleanupTestData } = testData;

describe('REGRESSION: branchSync routes through endpointAdapter to the spec-verified paths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('selectBranches posts to /branches/selectBranches under VSDC_MODE=official', async () => {
    const original = process.env.VSDC_MODE;
    process.env.VSDC_MODE = 'official';
    const postSpy = vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { bhfList: [] } },
    });

    await branchSync.selectBranches();

    expect(postSpy.mock.calls[0][0]).toBe('/branches/selectBranches');
    process.env.VSDC_MODE = original;
  });

  it('saveBranchUser posts to /branches/saveBrancheUser (singular) under VSDC_MODE=official', async () => {
    const original = process.env.VSDC_MODE;
    process.env.VSDC_MODE = 'official';
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({ success: true, data: { resultCd: '000' } });

    expect(endpointAdapter.path('branchUserSave')).toBe('/branches/saveBrancheUser');
    process.env.VSDC_MODE = original;
  });

  it('saveBranchCustomer posts to /branches/saveBrancheCustomers (plural) under VSDC_MODE=official', async () => {
    const original = process.env.VSDC_MODE;
    process.env.VSDC_MODE = 'official';
    expect(endpointAdapter.path('branchCustomerSave')).toBe('/branches/saveBrancheCustomers');
    process.env.VSDC_MODE = original;
  });

  it('selectCustomer posts to /customers/selectCustomer (distinct namespace) under VSDC_MODE=official', async () => {
    const original = process.env.VSDC_MODE;
    process.env.VSDC_MODE = 'official';
    expect(endpointAdapter.path('customerSelect')).toBe('/customers/selectCustomer');
    process.env.VSDC_MODE = original;
  });
});

describe('REGRESSION: saveBranchCustomer requires a TPIN (custTpin is a required VSDC field)', () => {
  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('throws without ever calling VSDC when the customer has no tpin', async () => {
    const postSpy = vi.spyOn(transport, 'authenticatedPost');
    const customer = await createTestCustomer({ tpin: null });

    await expect(branchSync.saveBranchCustomer(customer, { id: 'actor-1' })).rejects.toThrow(/no TPIN/);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('succeeds and persists zraSyncedAt when the customer has a tpin', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', resultMsg: 'It is succeeded' },
    });
    const customer = await createTestCustomer({ tpin: '2000000123' });

    const result = await branchSync.saveBranchCustomer(customer, { id: 'actor-1', name: 'Actor' });

    expect(result.success).toBe(true);
    const updated = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(updated.zraSyncedAt).toBeTruthy();
    expect(updated.zraSyncError).toBeNull();
  });

  it('REGRESSION: surfaces a ZRA rejection clearly and records zraSyncError, not a silent success', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '904', resultMsg: 'Invalid customer TPIN' },
    });
    const customer = await createTestCustomer({ tpin: '2000000999' });

    await expect(branchSync.saveBranchCustomer(customer, { id: 'actor-1' })).rejects.toThrow(/Invalid customer TPIN/);

    const updated = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(updated.zraSyncError).toMatch(/Invalid customer TPIN/);
    expect(updated.zraSyncedAt).toBeNull();
  });
});

describe('REGRESSION: saveBranchUser requires an assigned branch (bhfId is a required VSDC field)', () => {
  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('throws without calling VSDC when the user has no branch', async () => {
    const postSpy = vi.spyOn(transport, 'authenticatedPost');
    const user = await createTestUser({ branchId: null });

    await expect(branchSync.saveBranchUser({ ...user, branch: null }, { id: 'actor-1' })).rejects.toThrow(/no assigned branch/);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('succeeds and persists zraSyncedAt when the user has a branch', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', resultMsg: 'It is succeeded' },
    });
    await createTestBranch();
    const user = await createTestUser();
    const withBranch = await prisma.user.findUnique({
      where: { id: user.id },
      include: { branch: { select: { bhfId: true } } },
    });

    const result = await branchSync.saveBranchUser(withBranch, { id: 'actor-1', name: 'Actor' });

    expect(result.success).toBe(true);
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated.zraSyncedAt).toBeTruthy();
  });
});

describe('REGRESSION: selectBranches stores a reference snapshot without overwriting operational Branch fields', () => {
  afterEach(async () => {
    await cleanupTestData();
    vi.restoreAllMocks();
  });

  it('updates zraBranchSnapshot but leaves name/province untouched', async () => {
    const branch = await createTestBranch();
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: {
        resultCd: '000',
        data: { bhfList: [{ bhfId: branch.bhfId, bhfNm: 'A Completely Different Name From ZRA', prvncNm: 'SOME OTHER PROVINCE' }] },
      },
    });

    await branchSync.selectBranches();

    const updated = await prisma.branch.findUnique({ where: { id: branch.id } });
    expect(updated.name).toBe(branch.name); // unchanged — operational field
    expect(updated.zraBranchSnapshot.bhfNm).toBe('A Completely Different Name From ZRA');
    expect(updated.zraSnapshotSyncedAt).toBeTruthy();
  });

  it('propagates a clear failure on API error rather than silently succeeding', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({ success: false, data: { resultMsg: 'VSDC unreachable' } });

    await expect(branchSync.selectBranches()).rejects.toThrow(/VSDC unreachable/);
  });
});

describe('REGRESSION: selectCustomer (Get Customer lookup)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a found customer correctly', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { custList: [{ custTpin: '2000000123', custNm: 'Jane Test' }] } },
    });

    const result = await branchSync.selectCustomer('2000000123');

    expect(result.found).toBe(true);
    expect(result.customer.custNm).toBe('Jane Test');
  });

  it('returns found:false on an empty result, not an error', async () => {
    vi.spyOn(transport, 'authenticatedPost').mockResolvedValue({
      success: true,
      data: { resultCd: '000', data: { custList: [] } },
    });

    const result = await branchSync.selectCustomer('9999999999');

    expect(result.found).toBe(false);
    expect(result.customer).toBeNull();
  });
});
