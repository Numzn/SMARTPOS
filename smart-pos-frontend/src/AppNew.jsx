import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SalesProvider } from './contexts/SalesContext';
import LoginForm from './components/auth/LoginForm';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import Dashboard from './components/Dashboard';
import ProductsPage from './components/products/ProductsPage';
import ReportsPage from './components/reports/ReportsPage';

function App() {
  return (
    <AuthProvider>
      <SalesProvider>
        <Router>
          <div className="min-h-screen bg-gray-50">
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<LoginForm />} />
              
              {/* Protected Routes */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <MainLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="sales" element={<Dashboard />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<div className="p-6"><h1 className="text-2xl font-bold">Settings</h1><p>Settings page coming soon...</p></div>} />
              </Route>

              {/* Catch all redirect */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </Router>
      </SalesProvider>
    </AuthProvider>
  );
}

export default App;
