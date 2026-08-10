/**
 * ZRA certification item 17*: "unique and consecutive invoice numbers".
 *
 * The concurrency test here is the point of this file. The original
 * implementation read `lastInvcNo`, added 1 in JavaScript, then wrote the
 * literal back — inside a transaction, but at READ COMMITTED with no row lock.
 * Two concurrent checkouts therefore both read N and both wrote N+1, and both
 * submitted the same `invcNo` to ZRA. There is no unique index to catch it.
 *
 * A serial-only test passes against that bug, which is why it is not the only
 * test here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import fiscalInvoiceNumber from '../../lib/fiscalInvoiceNumber.js';

const { prisma } = testData;
const { allocateFiscalInvcNo } = fiscalInvoiceNumber;

const TEST_TPIN = 'TEST-TPIN-INVCNO';
const TEST_BHF = 'T01';

const ENV_KEYS = ['BUSINESS_TPIN', 'BRANCH_ID', 'DVC_SRL_NO'];
let savedEnv;

/** Point allocation at a device row this test owns exclusively. */
function useIsolatedDevice() {
  process.env.BUSINESS_TPIN = TEST_TPIN;
  process.env.BRANCH_ID = TEST_BHF;
  process.env.DVC_SRL_NO = `TESTSRL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('allocateFiscalInvcNo', () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    useIsolatedDevice();
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await prisma.vsdcDevice.deleteMany({ where: { tpin: TEST_TPIN } });
  });

  it('allocates strictly consecutive numbers when called serially', async () => {
    const allocated = [];
    for (let i = 0; i < 5; i += 1) {
      allocated.push(await allocateFiscalInvcNo());
    }
    expect(allocated).toEqual([1, 2, 3, 4, 5]);
  });

  it('never issues the same number twice under concurrency', async () => {
    const CONCURRENCY = 25;

    const allocated = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => allocateFiscalInvcNo())
    );

    // Distinctness is the ZRA requirement. Duplicates here mean two sales were
    // submitted to ZRA under one invoice number.
    expect(new Set(allocated).size).toBe(CONCURRENCY);

    // And the sequence must be gapless 1..N — an atomic increment yields exactly
    // the integers 1..N in some interleaving.
    expect([...allocated].sort((a, b) => a - b)).toEqual(
      Array.from({ length: CONCURRENCY }, (_, i) => i + 1)
    );
  });

  it('does not duplicate when several callers race the very first allocation', async () => {
    // No device row exists yet, so every caller takes the create branch. Exactly
    // one create can win; the losers must fall back to the increment rather than
    // throwing a unique-constraint error at the till.
    const allocated = await Promise.all(
      Array.from({ length: 8 }, () => allocateFiscalInvcNo())
    );

    expect(new Set(allocated).size).toBe(8);
    expect([...allocated].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('continues from the stored counter rather than restarting', async () => {
    await allocateFiscalInvcNo();
    await allocateFiscalInvcNo();

    const device = await prisma.vsdcDevice.findFirst({ where: { tpin: TEST_TPIN } });
    expect(device.lastInvcNo).toBe(2);

    expect(await allocateFiscalInvcNo()).toBe(3);
  });
});
