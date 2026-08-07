import { describe, it, expect } from 'vitest';
import auth from '../../middleware/auth.js';

const { PERMISSIONS } = auth;

/**
 * The till's permission set is load-bearing: a cashier who cannot read fiscal
 * status sees the POS report ZRA as offline while it is healthy, which is the
 * kind of thing that stops someone trading for no reason.
 */
describe('CASHIER permission set', () => {
  it('REGRESSION: can read fiscal device status, so the till never falsely reports ZRA offline', () => {
    expect(PERMISSIONS.CASHIER).toContain('zra:read');
  });

  it('has everything the till needs to complete a sale', () => {
    for (const permission of [
      'products:read',
      'categories:read',
      'inventory:read',
      'sales:read',
      'sales:write',
      'receipts:read',
      'shifts:write',
      'customers:read',
      'customers:write',
      'zra:read',
    ]) {
      expect(PERMISSIONS.CASHIER).toContain(permission);
    }
  });

  it('stays read-only on fiscal operations — status yes, submission and sync no', () => {
    expect(PERMISSIONS.CASHIER).not.toContain('zra:submit');
    expect(PERMISSIONS.CASHIER).not.toContain('zra:sync');
  });

  it('remains a till role, not a back-office one', () => {
    for (const permission of [
      'users:write',
      'products:write',
      'suppliers:read',
      'purchasing:write',
      'reports:read',
      'audit:read',
      'settings:write',
      'customers:delete',
      'shifts:read', // own shift only; shifts:read would expose every cashier's
    ]) {
      expect(PERMISSIONS.CASHIER).not.toContain(permission);
    }
  });
});
