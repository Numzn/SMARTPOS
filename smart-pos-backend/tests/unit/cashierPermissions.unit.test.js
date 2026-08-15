import { describe, it, expect } from 'vitest';
import auth from '../../middleware/auth.js';

const { PERMISSIONS } = auth;

/**
 * The till's permission set is load-bearing: a cashier who cannot read fiscal
 * status sees the POS report ZRA as offline while it is healthy, which is the
 * kind of thing that stops someone trading for no reason. This file checks
 * PERMISSIONS (== lib/permissions.js:DEFAULT_PERMISSIONS, the seed/fallback
 * matrix) — the live, DB-backed matrix is exercised in
 * rolePermissions.integration.test.js.
 */
describe('CASHIER permission set', () => {
  it('REGRESSION: can check fiscal device status, so the till never falsely reports ZRA offline', () => {
    expect(PERMISSIONS.CASHIER).toContain('zra:status');
  });

  it('has everything the till needs to complete a sale', () => {
    for (const permission of [
      'sales:read',
      'sales:write',
      'receipts:read',
      'shifts:recordMovement',
      'customers:read',
      'customers:write',
      'zra:status',
    ]) {
      expect(PERMISSIONS.CASHIER).toContain(permission);
    }
  });

  it('REGRESSION: cannot open or end a shift — only Supervisor+ operates the till lifecycle', () => {
    expect(PERMISSIONS.CASHIER).not.toContain('shifts:operate');
  });

  it('stays read-only on fiscal operations — status yes, page access/submission/sync/admin no', () => {
    expect(PERMISSIONS.CASHIER).not.toContain('zra:read');
    expect(PERMISSIONS.CASHIER).not.toContain('zra:submit');
    expect(PERMISSIONS.CASHIER).not.toContain('zra:sync');
    expect(PERMISSIONS.CASHIER).not.toContain('zra:admin');
  });

  it('has no product/inventory/category management access — POS catalog lookup does not require it (see routes/products.js optionalAuth routes)', () => {
    expect(PERMISSIONS.CASHIER).not.toContain('products:read');
    expect(PERMISSIONS.CASHIER).not.toContain('categories:read');
    expect(PERMISSIONS.CASHIER).not.toContain('inventory:read');
  });

  it('has no drawer-financial visibility or self-reconciliation power', () => {
    for (const permission of [
      'shifts:viewExpected',
      'shifts:countCash',
      'shifts:viewVariance',
      'shifts:reconcile',
      'shifts:viewAll',
      'shifts:reopen',
    ]) {
      expect(PERMISSIONS.CASHIER).not.toContain(permission);
    }
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
      'roles:manage',
    ]) {
      expect(PERMISSIONS.CASHIER).not.toContain(permission);
    }
  });
});

describe('SUPERVISOR permission set', () => {
  it('has the same operational baseline as CASHIER, plus reconciliation authority', () => {
    for (const permission of ['sales:write', 'shifts:operate', 'shifts:viewExpected', 'shifts:countCash', 'shifts:viewVariance', 'shifts:reconcile']) {
      expect(PERMISSIONS.SUPERVISOR).toContain(permission);
    }
  });

  it('does not automatically inherit store-wide oversight or management modules', () => {
    for (const permission of ['shifts:viewAll', 'shifts:reopen', 'products:read', 'inventory:read', 'reports:read', 'zra:read', 'settings:read']) {
      expect(PERMISSIONS.SUPERVISOR).not.toContain(permission);
    }
  });
});

describe('ADMIN permission set — no code bypass, explicit rows only', () => {
  it('holds every recognized permission, including roles:manage', () => {
    expect(PERMISSIONS.ADMIN).toContain('roles:manage');
    expect(PERMISSIONS.ADMIN).toContain('zra:admin');
    expect(PERMISSIONS.ADMIN).toContain('shifts:reopen');
  });
});
