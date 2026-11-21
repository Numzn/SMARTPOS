/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { getInitialToken, saveToken, clearToken, saveSession, getCachedSession } from '../lib/tokenStore';
import { isTokenUnexpired, tokenUserId } from '../lib/jwt';
import { getConnectivity, subscribeConnectivity } from '../lib/connectivity';

// How long the startup sign-in check may take before we treat the server as
// unreachable. Without it a black-holed connection leaves the spinner up for minutes.
const PROFILE_TIMEOUT_MS = 8000;

/**
 * Offline session: the last known user, but ONLY if the stored token has not
 * expired and was issued to that same user. Never an authority: the server
 * re-validates it as soon as it is reachable (see the re-check effect below).
 */
function restoreOfflineSession(token) {
  const cached = getCachedSession();
  if (!cached || !isTokenUnexpired(token)) return null;
  const tokenUser = tokenUserId(token);
  const cachedId = cached.id ?? cached.userId;
  if (tokenUser == null || cachedId == null || String(tokenUser) !== String(cachedId)) return null;
  return cached;
}

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(getInitialToken());
  // True while the signed-in user is the saved snapshot, not yet confirmed by the server.
  const [offlineSession, setOfflineSession] = useState(false);
  const revalidating = useRef(false);

  // Check if user is authenticated on app start
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      if (token) {
        try {
          const response = await api.get('/users/profile', { timeoutMs: PROFILE_TIMEOUT_MS });
          if (cancelled) return;
          setUser(response.data);
          setOfflineSession(false);
          saveSession(response.data);
        } catch (error) {
          if (cancelled) return;
          if (error.kind === 'network') {
            // The server could not be reached. That says nothing about whether the
            // session is valid, so do NOT sign the user out or discard the token.
            const restored = restoreOfflineSession(token);
            if (restored) {
              setUser(restored);
              setOfflineSession(true);
            }
          } else {
            console.error('Auth check failed:', error);
            logout();
          }
        }
      }
      if (!cancelled) setLoading(false);
    };

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // While the saved session (or a kept token with no user) is waiting on the
  // server, re-validate as soon as it answers. A 401 then signs out as usual.
  useEffect(() => {
    if (!token || loading || (user && !offlineSession)) return undefined;

    const revalidate = async () => {
      if (revalidating.current) return;
      revalidating.current = true;
      try {
        const response = await api.get('/users/profile', { timeoutMs: PROFILE_TIMEOUT_MS });
        setUser(response.data);
        setOfflineSession(false);
        saveSession(response.data);
      } catch (error) {
        if (error.kind !== 'network') logout();
      } finally {
        revalidating.current = false;
      }
    };

    if (getConnectivity().status === 'ONLINE') revalidate();
    return subscribeConnectivity((s) => {
      if (s.status === 'ONLINE') revalidate();
    });
  }, [token, loading, user, offlineSession]);

  const login = async (email, password) => {
    try {
      const response = await api.post('/users/login', {
        email,
        password
      });

      const { token: newToken, user: userData } = response.data;
      
      // Web: cookie (7 days) + localStorage. Desktop: OS-backed secure store.
      // See lib/tokenStore.js.
      saveToken(newToken);
      saveSession(userData);
      setToken(newToken);
      setUser(userData);
      setOfflineSession(false);

      return { success: true, user: userData };
    } catch (error) {
      let message = 'Login failed';

      // Written for whoever is actually standing at the till. The previous
      // wording told shop staff to run npm commands in a source directory,
      // which is unactionable on a real terminal and reads like the system is
      // broken beyond repair.
      if (!error.response) {
        message =
          'Cannot reach the server. Check this terminal’s network connection, then try again. If the connection is fine, contact your administrator.';
      } else if (error.response.data?.error) {
        message = error.response.data.error;
      } else if (error.response.status === 500) {
        message = 'The server could not complete the sign-in. Please try again, or contact your administrator if this continues.';
      }

      console.error('Login error:', error.response?.data || error.message);

      return { success: false, error: message };
    }
  };

  const logout = () => {
    clearToken();
    setToken(null);
    setUser(null);
    setOfflineSession(false);
  };

  const value = {
    user,
    token,
    loading,
    offlineSession,
    login,
    logout,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
