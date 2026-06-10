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
      
      return { success: true };
    } catch (error) {
      let message = 'Login failed';

      if (!error.response) {
        message =
          'Cannot reach the API server. Start the backend (port 4000) and Postgres, then try again.';
      } else if (error.response.data?.error) {
        message = error.response.data.error;
      } else if (error.response.status === 500) {
        message =
          'Server error during login. Check that Postgres is running (npm run db:up) and run npm run setup-db.';
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
