import { describe, it, expect } from 'vitest';
import saleFiscal from '../../lib/saleFiscal.js';

const { parseSalePayload, extractZraFromVsdcPayload } = saleFiscal;

describe('parseSalePayload', () => {
  const baseBody = () => ({
    userId: 'user-1',
    items: [{ productId: 'prod-1', quantity: 2, price: 50 }],
  });

  it('throws 400 when userId is missing', () => {
    const body = baseBody();
    delete body.userId;
    expect(() => parseSalePayload(body)).toThrowError(/userId and items/);
    try {
      parseSalePayload(body);
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  it('throws 400 when items is empty', () => {
    expect(() => parseSalePayload({ userId: 'user-1', items: [] })).toThrowError(/userId and items/);
  });

  it('throws 400 on a zero or negative quantity', () => {
    const body = baseBody();
    body.items[0].quantity = 0;
    expect(() => parseSalePayload(body)).toThrowError(/Invalid quantity/);

    body.items[0].quantity = -3;
    expect(() => parseSalePayload(body)).toThrowError(/Invalid quantity/);
  });

  it('throws 400 on a negative price (regression: checkout previously accepted this)', () => {
    const body = baseBody();
    body.items[0].price = -10;
    expect(() => parseSalePayload(body)).toThrowError(/Invalid price/);
  });

  it('throws 400 on a non-finite price or quantity', () => {
    const body = baseBody();
    body.items[0].price = NaN;
    expect(() => parseSalePayload(body)).toThrowError(/Invalid price/);
  });

  it('accepts a zero price (e.g. free promotional item) but not a negative one', () => {
    const body = baseBody();
    body.items[0].price = 0;
    expect(() => parseSalePayload(body)).not.toThrow();
  });

  it('computes subtotal/total correctly for valid items', () => {
    const parsed = parseSalePayload({
      userId: 'user-1',
      items: [
        { productId: 'p1', quantity: 2, price: 50 },
        { productId: 'p2', quantity: 1, price: 25 },
      ],
      tax: 20,
      discount: 5,
    });

    expect(parsed.subtotal).toBe(125);
    expect(parsed.taxAmount).toBe(20);
    expect(parsed.discountAmount).toBe(5);
    expect(parsed.total).toBe(140);
    expect(parsed.paymentMethod).toBe('CASH');
    expect(parsed.branchId).toBe('main');
  });

  it('maps customerInfo and paymentDetails onto the parsed payload', () => {
    const parsed = parseSalePayload({
      userId: 'user-1',
      items: [{ productId: 'p1', quantity: 1, price: 10 }],
      customerInfo: { name: '  Jane Doe  ', tpin: ' 1000000000 ' },
      paymentDetails: { cashReceived: '20', change: '10' },
    });

    expect(parsed.customerName).toBe('Jane Doe');
    expect(parsed.customerTpin).toBe('1000000000');
    expect(parsed.amountPaid).toBe(20);
    expect(parsed.changeAmount).toBe(10);
  });
});

describe('extractZraFromVsdcPayload', () => {
  it('returns null for a falsy or non-object payload', () => {
    expect(extractZraFromVsdcPayload(null)).toBeNull();
    expect(extractZraFromVsdcPayload(undefined)).toBeNull();
    expect(extractZraFromVsdcPayload('not-an-object')).toBeNull();
  });

  it('returns null when there is no rcptNo anywhere', () => {
    expect(extractZraFromVsdcPayload({ foo: 'bar' })).toBeNull();
    expect(extractZraFromVsdcPayload({ data: { foo: 'bar' } })).toBeNull();
  });

  it('extracts fields from a flat payload', () => {
    const result = extractZraFromVsdcPayload({
      rcptNo: 'RCPT-1',
      qrCode: 'QR-1',
      rcptSign: 'SIGN-1',
    });
    expect(result).toEqual({
      rcptNo: 'RCPT-1',
      qrCode: 'QR-1',
      intrlData: 'SIGN-1',
      rcptSign: 'SIGN-1',
    });
  });

  it('extracts fields from a nested { data: {...} } payload, preferring intrlData over rcptSign', () => {
    const result = extractZraFromVsdcPayload({
      data: { rcptNo: 'RCPT-2', qrCode: 'QR-2', intrlData: 'INTRL-2', rcptSign: 'SIGN-2' },
    });
    expect(result.rcptNo).toBe('RCPT-2');
    expect(result.intrlData).toBe('INTRL-2');
    expect(result.rcptSign).toBe('SIGN-2');
  });
});
