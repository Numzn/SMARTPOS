/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import Cookies from 'js-cookie';
import api from '../services/api';

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
  const [token, setToken] = useState(Cookies.get('token'));

  // Check if user is authenticated on app start
  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const response = await api.get('/users/profile');
          setUser(response.data);
        } catch (error) {
          console.error('Auth check failed:', error);
          logout();
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [token]);

  const login = async (email, password) => {
    try {
      const response = await api.post('/users/login', {
        email,
        password
      });

      const { token: newToken, user: userData } = response.data;
      
      // Store token in cookie (7 days)
      // secure only on HTTPS — localhost dev uses http
      Cookies.set('token', newToken, {
        expires: 7,
        secure: window.location.protocol === 'https:',
        sameSite: 'lax',
      });
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setUser(userData);

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
    Cookies.remove('token');
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const value = {
    user,
    token,
    loading,
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
