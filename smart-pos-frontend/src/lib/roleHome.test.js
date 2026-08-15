import { describe, it, expect } from 'vitest';
import { getHomeRoute } from './roleHome';

describe('getHomeRoute', () => {
  it('sends CASHIER to /cashier — no dashboard workspace exists for this role', () => {
    expect(getHomeRoute('CASHIER')).toBe('/cashier');
  });

  it.each(['SUPERVISOR', 'MANAGER', 'ADMIN', 'VIEWER', undefined, null])(
    '%s -> /dashboard',
    (role) => {
      expect(getHomeRoute(role)).toBe('/dashboard');
    }
  );
});
