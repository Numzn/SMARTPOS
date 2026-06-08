import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SalesProvider } from './contexts/SalesContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import LoginForm from './components/auth/LoginForm';
import MainLayout from './components/layout/MainLayout';
import Dashboard from './components/dashboard/Dashboard';
import SalesPage from './components/sales/SalesPage';
import ProductsPage from './components/products/ProductsPage';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <SalesProvider>
        <Router>
          <div className="App">
            <Routes>
              {/* Public Routes */}
              <Route path="/login" element={<LoginForm />} />
              
              {/* Protected Routes */}
              <Route path="/" element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route 
                  path="sales" 
                  element={
                    <ProtectedRoute requiredPermission="sales:read">
                      <SalesPage />
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="products" 
                  element={
                    <ProtectedRoute requiredPermission="products:read">
                      <ProductsPage />
                    </ProtectedRoute>
                  } 
                />
              </Route>
              
              {/* Fallback */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </Router>
      </SalesProvider>
    </AuthProvider>
  );
}

export default App;
