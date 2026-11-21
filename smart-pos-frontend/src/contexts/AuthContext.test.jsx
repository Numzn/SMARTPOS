import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import Cookies from 'js-cookie';
import { ApiError, NetworkError } from '../lib/apiClient';
import { makeJwt, inOneHour } from '../testUtils/makeJwt';

const apiGet = vi.fn();
vi.mock('../services/api', () => ({
  default: { get: (...a) => apiGet(...a), post: vi.fn() },
}));

import { AuthProvider, useAuth } from './AuthContext';
import { saveSession, __resetTokenStoreForTests } from '../lib/tokenStore';
import { reportReachable, __resetConnectivityForTests } from '../lib/connectivity';

const USER = { id: 7, email: 'cashier@example.com', role: 'CASHIER', permissions: ['sales:write'] };

function Probe() {
  const { user, loading, offlineSession, token } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.email : 'none'}</span>
      <span data-testid="offline">{String(offlineSession)}</span>
      <span data-testid="token">{token ? 'yes' : 'no'}</span>
    </div>
  );
}
const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
const text = (id) => screen.getByTestId(id).textContent;

beforeEach(() => {
  apiGet.mockReset();
  __resetTokenStoreForTests();
  __resetConnectivityForTests();
  Cookies.remove('token');
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('startup sign-in check', () => {
  it('online: confirms the session with the server and remembers the user', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    apiGet.mockResolvedValue({ data: USER });
    mount();
    await waitFor(() => expect(text('loading')).toBe('false'));
    expect(text('user')).toBe(USER.email);
    expect(text('offline')).toBe('false');
    expect(apiGet).toHaveBeenCalledWith('/users/profile', expect.objectContaining({ timeoutMs: expect.any(Number) }));
  });

  it('server unreachable + saved session + valid token: stays signed in, flagged as an offline session, token kept', async () => {
    const token = makeJwt({ userId: 7, exp: inOneHour() });
    Cookies.set('token', token);
    saveSession(USER);
    apiGet.mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(text('loading')).toBe('false'));
    expect(text('user')).toBe(USER.email);
    expect(text('offline')).toBe('true');
    expect(Cookies.get('token')).toBe(token); // NOT logged out
  });

  it('server unreachable and nothing saved: not signed in, but the token is kept (no forced logout)', async () => {
    const token = makeJwt({ userId: 7, exp: inOneHour() });
    Cookies.set('token', token);
    apiGet.mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(text('loading')).toBe('false'));
    expect(text('user')).toBe('none');
    expect(Cookies.get('token')).toBe(token);
    expect(text('token')).toBe('yes');
  });

  it('does not restore a session whose token has expired', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: Math.floor(Date.now() / 1000) - 60 }));
    saveSession(USER);
    apiGet.mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(text('loading')).toBe('false'));
    expect(text('user')).toBe('none');
  });

  it('does not restore a session saved for a different user than the token was issued to', async () => {
    Cookies.set('token', makeJwt({ userId: 99, exp: inOneHour() }));
    saveSession(USER); // id 7
    apiGet.mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(text('loading')).toBe('false'));
    expect(text('user')).toBe('none');
  });

  it('a real rejection (401) still signs out and clears the token', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    saveSession(USER);
    apiGet.mockRejectedValue(new ApiError('Unauthorized', 401, {}));
    mount();
    await waitFor(() => expect(text('token')).toBe('no'));
    expect(text('user')).toBe('none');
    expect(Cookies.get('token')).toBeUndefined();
  });

  it('a business error (e.g. 403 or 500) also signs out, as before', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    apiGet.mockRejectedValue(new ApiError('Forbidden', 403, {}));
    mount();
    await waitFor(() => expect(text('token')).toBe('no'));
  });
});

describe('re-validation when the server comes back', () => {
  it('replaces the saved snapshot with fresh server data and clears the offline flag', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    saveSession(USER);
    apiGet.mockRejectedValueOnce(new NetworkError());
    mount();
    await waitFor(() => expect(text('offline')).toBe('true'));

    const fresh = { ...USER, permissions: ['sales:write', 'sales:read'], email: 'fresh@example.com' };
    apiGet.mockResolvedValue({ data: fresh });
    await act(async () => {
      reportReachable();
    });
    await waitFor(() => expect(text('offline')).toBe('false'));
    expect(text('user')).toBe('fresh@example.com');
  });

  it('signs out if the server then says the session is no longer valid (e.g. user deactivated while offline)', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    saveSession(USER);
    apiGet.mockRejectedValueOnce(new NetworkError());
    mount();
    await waitFor(() => expect(text('offline')).toBe('true'));

    apiGet.mockRejectedValue(new ApiError('Unauthorized', 401, {}));
    await act(async () => {
      reportReachable();
    });
    await waitFor(() => expect(text('user')).toBe('none'));
    expect(text('token')).toBe('no');
  });

  it('with a kept token but no saved user, signs straight back in when the server returns', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    apiGet.mockRejectedValueOnce(new NetworkError());
    mount();
    await waitFor(() => expect(text('loading')).toBe('false'));
    expect(text('user')).toBe('none');

    apiGet.mockResolvedValue({ data: USER });
    await act(async () => {
      reportReachable();
    });
    await waitFor(() => expect(text('user')).toBe(USER.email));
  });

  it('stays an offline session if the server is still unreachable', async () => {
    Cookies.set('token', makeJwt({ userId: 7, exp: inOneHour() }));
    saveSession(USER);
    apiGet.mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(text('offline')).toBe('true'));
    await act(async () => {
      reportReachable(); // heartbeat says up, but the profile call still fails
    });
    expect(text('offline')).toBe('true');
    expect(text('user')).toBe(USER.email);
  });
});
