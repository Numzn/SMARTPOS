import { describe, it, expect, afterEach } from 'vitest';
import { mode, fiscalizeTransaction } from '../../lib/forecourt/fiscalAdapter.js';

// A regression guard tied directly to the "never claim ZRA/VSDC compliance"
// requirement: mock output must always be unmistakably synthetic.
describe('lib/forecourt/fiscalAdapter', () => {
  afterEach(() => {
    delete process.env.FORECOURT_FISCAL_MODE;
  });

  it('defaults to mock mode', () => {
    expect(mode()).toBe('mock');
  });

  it('never throws and always returns a well-formed shape', async () => {
    const result = await fiscalizeTransaction({ branchId: 'main', amount: 552.42 });
    expect(result).toHaveProperty('success');
  });

  it('mock fiscalization succeeds with unmistakably synthetic output', async () => {
    const transaction = { branchId: 'main', amount: 552.42 };
    const result = await fiscalizeTransaction(transaction);

    expect(result.success).toBe(true);
    expect(result.fiscalRecord.provider).toBe('mock');
    expect(result.fiscalRecord.scope).toBe('TRANSACTION');
    expect(result.fiscalRecord.branchId).toBe('main');
    expect(result.fiscalRecord.amount).toBe(552.42);
    expect(result.fiscalRecord.rcptNo).toMatch(/^MOCK-/);
    expect(result.fiscalRecord.qrCode).toMatch(/^MOCK-/);
    expect(result.fiscalRecord.rcptSign).toMatch(/^MOCK-/);
    expect(result.fiscalRecord.submittedAt).toBeInstanceOf(Date);
  });

  it('returns a well-formed failure, not a throw, for an unimplemented provider', async () => {
    process.env.FORECOURT_FISCAL_MODE = 'vsdc';
    const result = await fiscalizeTransaction({ branchId: 'main', amount: 100 });

    expect(result.success).toBe(false);
    expect(result.code).toBe('FISCAL_PROVIDER_NOT_IMPLEMENTED');
    expect(typeof result.error).toBe('string');
  });
});
