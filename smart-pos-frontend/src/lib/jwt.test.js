import { describe, it, expect } from 'vitest';
import { decodeJwtPayload, isTokenUnexpired, tokenUserId } from './jwt';
import { makeJwt } from '../testUtils/makeJwt';

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('jwt helpers (no signature checking: the server does that)', () => {
  it('decodes the payload, including url-safe base64 and non-ASCII', () => {
    const t = makeJwt({ userId: 7, name: 'Zoë ✓', exp: future() });
    expect(decodeJwtPayload(t)).toMatchObject({ userId: 7, name: 'Zoë ✓' });
  });

  it('rejects anything that is not a three-part token with a JSON payload', () => {
    for (const bad of [null, undefined, 42, '', 'abc', 'a.b', 'a.b.c.d', 'x.!!!.z', `x.${btoa('not json')}.z`]) {
      expect(decodeJwtPayload(bad)).toBeNull();
    }
  });

  it('expiry: valid only with a future exp claim', () => {
    expect(isTokenUnexpired(makeJwt({ exp: future() }))).toBe(true);
    expect(isTokenUnexpired(makeJwt({ exp: Math.floor(Date.now() / 1000) - 5 }))).toBe(false);
    expect(isTokenUnexpired(makeJwt({ userId: 1 }))).toBe(false); // no exp = not trusted offline
    expect(isTokenUnexpired('garbage')).toBe(false);
    expect(isTokenUnexpired(makeJwt({ exp: 100 }), 99_000)).toBe(true); // injectable clock
  });

  it('reads the user id claim', () => {
    expect(tokenUserId(makeJwt({ userId: 12, exp: future() }))).toBe(12);
    expect(tokenUserId(makeJwt({ exp: future() }))).toBeNull();
  });
});
