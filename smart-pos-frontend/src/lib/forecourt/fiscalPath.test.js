import { describe, it, expect } from 'vitest';
import { determineFiscalPath } from './fiscalPath';

describe('determineFiscalPath', () => {
  it('fiscalizes B2B immediately regardless of invoiceRequested', () => {
    expect(determineFiscalPath({ customerType: 'B2B', invoiceRequested: false })).toEqual({
      fiscalizeNow: true,
      initialFiscalStatus: 'PENDING',
    });
    expect(determineFiscalPath({ customerType: 'B2B', invoiceRequested: true })).toEqual({
      fiscalizeNow: true,
      initialFiscalStatus: 'PENDING',
    });
  });

  it('fiscalizes B2C immediately when an invoice is requested', () => {
    expect(determineFiscalPath({ customerType: 'B2C', invoiceRequested: true })).toEqual({
      fiscalizeNow: true,
      initialFiscalStatus: 'PENDING',
    });
  });

  it('defers ordinary B2C (no invoice requested) into the summary pool path', () => {
    expect(determineFiscalPath({ customerType: 'B2C', invoiceRequested: false })).toEqual({
      fiscalizeNow: false,
      initialFiscalStatus: 'SUMMARY_PENDING',
    });
  });

  it('defaults to the B2C-normal path when fields are missing', () => {
    expect(determineFiscalPath({})).toEqual({ fiscalizeNow: false, initialFiscalStatus: 'SUMMARY_PENDING' });
    expect(determineFiscalPath()).toEqual({ fiscalizeNow: false, initialFiscalStatus: 'SUMMARY_PENDING' });
  });
});
