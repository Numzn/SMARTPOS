import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// requiredRole / requiredPermission accept either a single string (must
// match) or an array (any-of) — the array form is what closes the
// direct-URL-bypass gap: every nested route in App.jsx now names the
// permission(s) it actually needs, so typing a URL directly is subject to
// the same boundary as the sidebar, not a way around it.
const toArray = (value) => (value == null ? null : Array.isArray(value) ? value : [value]);

const ProtectedRoute = ({ children, requiredRole = null, requiredPermission = null }) => {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const roles = toArray(requiredRole);
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
          <p className="text-gray-600">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  const permissions = toArray(requiredPermission);
  if (permissions && !permissions.some((p) => user.permissions?.includes(p))) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
          <p className="text-gray-600">You don't have the required permissions.</p>
        </div>
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;
