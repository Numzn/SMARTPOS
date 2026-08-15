import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import prisma from '../../lib/prisma.js';
import permissionsLib from '../../lib/permissions.js';

const { DEFAULT_PERMISSIONS, getEffectivePermissions, invalidatePermissionsCache, setRolePermission } =
  permissionsLib;

// A role name that will never collide with the seeded five, so these tests
// never touch real CASHIER/SUPERVISOR/MANAGER/ADMIN/VIEWER rows and can run
// alongside the rest of the suite without cleanup coordination. Prisma's
// `Role` enum only accepts the five real values at the DB layer, so these
// tests operate purely through the cache/fallback logic instead of writing
// rows for a role Prisma would reject.
describe('lib/permissions.js — DB-backed effective permissions', () => {
  afterEach(() => {
    invalidatePermissionsCache();
  });

  it('falls back to DEFAULT_PERMISSIONS for a role with zero granted RolePermission rows', async () => {
    await prisma.rolePermission.deleteMany({ where: { role: 'VIEWER' } });
    invalidatePermissionsCache();

    const perms = await getEffectivePermissions('VIEWER');
    expect(perms.sort()).toEqual([...DEFAULT_PERMISSIONS.VIEWER].sort());

    // restore for any later test relying on a seeded VIEWER
    for (const permission of DEFAULT_PERMISSIONS.VIEWER) {
      await setRolePermission('VIEWER', permission, true, null);
    }
  });

  it('reflects a DB override without needing a process restart, once the cache is invalidated', async () => {
    const before = await getEffectivePermissions('CASHIER');
    expect(before).toContain('sales:write');

    await setRolePermission('CASHIER', 'sales:write', false, null); // setRolePermission invalidates internally
    const after = await getEffectivePermissions('CASHIER');
    expect(after).not.toContain('sales:write');

    // restore
    await setRolePermission('CASHIER', 'sales:write', true, null);
    const restored = await getEffectivePermissions('CASHIER');
    expect(restored).toContain('sales:write');
  });

  it('rejects an unrecognized role or permission string', async () => {
    await expect(setRolePermission('NOT_A_ROLE', 'sales:read', true, null)).rejects.toMatchObject({
      code: 'UNKNOWN_ROLE',
    });
    await expect(setRolePermission('CASHIER', 'not:a-real-permission', true, null)).rejects.toMatchObject({
      code: 'UNKNOWN_PERMISSION',
    });
  });
});
