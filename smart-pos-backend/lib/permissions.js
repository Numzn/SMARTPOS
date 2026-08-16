const prisma = require('./prisma');

/**
 * Configurable RBAC — default role -> permission matrix.
 *
 * This is the seed data for the `RolePermission` table (see prisma/seed.js)
 * and the fallback used if a role somehow has zero rows post-seed. At
 * runtime, `getEffectivePermissions()` reads from the database, not this
 * object — so editing this constant alone does not change live behavior;
 * it only changes what a fresh seed produces.
 *
 * Four permission tiers exist for the two domains that used to be one coarse
 * permission each:
 *   - shifts:*  — operating a till is not the same as reconciling one
 *     (segregation of duties: a cashier can never see expectedCash/variance
 *     or close their own drawer; only a supervisor+ with `shifts:reconcile`
 *     can, and never on their own shift — enforced in code, not by
 *     permission, in routes/shifts.js). `shifts:operate` covers opening a
 *     shift, recording cash movements, and *requesting* a shift end — every
 *     till-facing role holds it. Actually ending a shift additionally
 *     requires a consumed SHIFT_END approval ticket (a Supervisor+ PIN),
 *     enforced at the route regardless of who holds shifts:operate — even a
 *     Supervisor ending their own shift needs a second person, since
 *     self-approval is unconditionally blocked in lib/approval.js.
 *     `shifts:recordMovement` remains as a narrower fallback: acting on the
 *     branch's active shift without owning it (e.g. a role that can help out
 *     at a till without opening its own).
 *   - zra:*     — a lightweight connectivity check (`zra:status`) is not the
 *     same as the ZRA Sync page / operational visibility (`zra:read`), which
 *     is not the same as triggering syncs (`zra:sync`) or provisioning a
 *     device (`zra:admin`).
 *
 * ADMIN has no code-level bypass anywhere in this system — every permission
 * ADMIN holds is an explicit row here/in the DB, toggle-able like any other
 * role's.
 */
const DEFAULT_PERMISSIONS = {
  ADMIN: [
    'users:read', 'users:write', 'users:delete',
    'products:read', 'products:write', 'products:delete',
    'categories:read', 'categories:write', 'categories:delete',
    'inventory:read', 'inventory:write', 'inventory:delete',
    'sales:read', 'sales:write', 'sales:delete', 'sales:refund',
    'receipts:read',
    'customers:read', 'customers:write', 'customers:delete',
    'suppliers:read', 'suppliers:write', 'suppliers:delete',
    'purchasing:read', 'purchasing:write',
    'reports:read', 'reports:write',
    'settings:read', 'settings:write',
    'audit:read',
    'shifts:operate', 'shifts:viewExpected', 'shifts:countCash', 'shifts:viewVariance',
    'shifts:reconcile', 'shifts:viewAll', 'shifts:reopen', 'shifts:adjust',
    'zra:status', 'zra:read', 'zra:sync', 'zra:submit', 'zra:admin',
    'roles:manage',
  ],
  MANAGER: [
    'users:read',
    'products:read', 'products:write', 'products:delete',
    'categories:read', 'categories:write', 'categories:delete',
    'inventory:read', 'inventory:write', 'inventory:delete',
    'sales:read', 'sales:write', 'sales:refund',
    'receipts:read',
    'customers:read', 'customers:write', 'customers:delete',
    'suppliers:read', 'suppliers:write', 'suppliers:delete',
    'purchasing:read', 'purchasing:write',
    'reports:read', 'reports:write',
    'audit:read',
    'shifts:operate', 'shifts:viewExpected', 'shifts:countCash', 'shifts:viewVariance',
    'shifts:reconcile', 'shifts:viewAll', 'shifts:reopen', 'shifts:adjust',
    'zra:status', 'zra:read', 'zra:sync', 'zra:submit',
  ],
  // Same operational baseline as CASHIER, plus reconciliation authority.
  // Supervisor's extra power comes from these granular shift permissions,
  // not from rank alone — Supervisor does NOT automatically inherit
  // management-module access (products/inventory/reports/etc).
  SUPERVISOR: [
    'sales:read', 'sales:write',
    'receipts:read',
    'customers:read', 'customers:write',
    'shifts:operate', 'shifts:viewExpected', 'shifts:countCash', 'shifts:viewVariance',
    'shifts:reconcile',
    'zra:status',
  ],
  CASHIER: [
    'sales:read', 'sales:write',
    'receipts:read',
    'customers:read', 'customers:write',
    // Open own shift, record cash movements, and request a shift end (which
    // still requires a Supervisor+ PIN to actually complete — see
    // routes/shifts.js:POST /:id/end). Not shifts:viewExpected/viewVariance/
    // reconcile — a Cashier never sees drawer financials or reconciles.
    'shifts:operate',
    // Read-only fiscal device status. A cashier has to be able to tell
    // whether ZRA submission is working — it decides whether they keep
    // trading. This is deliberately the *only* ZRA permission Cashier
    // holds: it does not grant access to the ZRA Sync page or any
    // operational/admin ZRA data (see zra:read/zra:sync/zra:admin below).
    'zra:status',
  ],
  VIEWER: [
    'products:read',
    'categories:read',
    'inventory:read',
    'sales:read',
    'suppliers:read',
    'purchasing:read',
    'reports:read',
    'shifts:viewAll',
  ],
};

// Every recognized permission string — used to reject unknown values on
// PUT /api/settings/roles/:role instead of silently persisting a typo.
const ALL_PERMISSIONS = [...new Set(Object.values(DEFAULT_PERMISSIONS).flat())].sort();

const CACHE_TTL_MS = 60 * 1000;
let cache = null; // Map<Role, string[]>
let cacheLoadedAt = 0;

async function loadFromDb() {
  const rows = await prisma.rolePermission.findMany({ where: { granted: true } });
  const map = new Map();
  for (const role of Object.keys(DEFAULT_PERMISSIONS)) {
    map.set(role, []);
  }
  for (const row of rows) {
    if (!map.has(row.role)) map.set(row.role, []);
    map.get(row.role).push(row.permission);
  }
  // Safety net: a role with zero granted rows (e.g. seed never ran) falls
  // back to the code default rather than silently locking everyone out.
  for (const [role, perms] of map.entries()) {
    if (perms.length === 0 && DEFAULT_PERMISSIONS[role]) {
      map.set(role, [...DEFAULT_PERMISSIONS[role]]);
    }
  }
  return map;
}

async function refreshIfStale() {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;
  cache = await loadFromDb();
  cacheLoadedAt = Date.now();
}

/**
 * Effective permissions for a role, right now — DB-backed, cached. This is
 * what `authenticateToken` calls on every request.
 */
async function getEffectivePermissions(role) {
  await refreshIfStale();
  return cache.get(role) || [];
}

/**
 * Called synchronously by any write to RolePermission (see
 * routes/settings.js). This, not the TTL, is what makes a permission change
 * take effect immediately — the TTL is only a safety net for cache staleness
 * across multiple server instances that didn't receive the invalidation.
 */
function invalidatePermissionsCache() {
  cache = null;
  cacheLoadedAt = 0;
}

async function listRolePermissions() {
  const rows = await prisma.rolePermission.findMany({ orderBy: [{ role: 'asc' }, { permission: 'asc' }] });
  return rows;
}

async function setRolePermission(role, permission, granted, updatedBy) {
  if (!Object.keys(DEFAULT_PERMISSIONS).includes(role)) {
    throw Object.assign(new Error(`Unknown role: ${role}`), { code: 'UNKNOWN_ROLE' });
  }
  if (!ALL_PERMISSIONS.includes(permission)) {
    throw Object.assign(new Error(`Unknown permission: ${permission}`), { code: 'UNKNOWN_PERMISSION' });
  }
  const row = await prisma.rolePermission.upsert({
    where: { role_permission: { role, permission } },
    create: { role, permission, granted: !!granted, updatedBy },
    update: { granted: !!granted, updatedBy },
  });
  invalidatePermissionsCache();
  return row;
}

module.exports = {
  DEFAULT_PERMISSIONS,
  ALL_PERMISSIONS,
  getEffectivePermissions,
  invalidatePermissionsCache,
  listRolePermissions,
  setRolePermission,
};
