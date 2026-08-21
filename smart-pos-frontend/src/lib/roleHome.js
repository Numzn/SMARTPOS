// Cashier's journey starts directly at the POS — there is no Cashier
// dashboard workspace at all (see navItems.js's DASHBOARD_ITEM: its `show`
// role-gates out CASHIER, not just permission-gated). Every other role
// lands on /dashboard as before. Kept as one small helper so login,
// route-guard, and catch-all redirect logic can't drift from each other.
export function getHomeRoute(role) {
  return role === 'CASHIER' ? '/cashier' : '/dashboard';
}
