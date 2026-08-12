import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import LoginForm from './components/auth/LoginForm';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';

// Eager: the till and the landing screen. A cashier must never wait on a chunk
// fetch mid-queue, and on a shaky connection a lazy Cashier route could fail to
// load at exactly the wrong moment.
import CashierPage from './pages/CashierPage';
import Dashboard from './components/dashboard/Dashboard';

// Lazy: back-office screens most users never open in a given session. These
// carry the bulk of the bundle (report tabs, purchasing, admin) and are always
// reached by deliberate navigation, where a brief load is acceptable.
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const ReportsPage = lazy(() => import('./components/reports/ReportsPage'));
const SalesPage = lazy(() => import('./components/sales/SalesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PrintersPage = lazy(() => import('./pages/PrintersPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const CashRegisterPage = lazy(() => import('./pages/CashRegisterPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const ZraSyncPage = lazy(() => import('./pages/ZraSyncPage'));

const RouteFallback = () => (
  <div className="p-10 text-center text-gray-500" role="status" aria-live="polite">
    Loading…
  </div>
);

function App() {
  return (
    <AuthProvider>
      <Router future={{ v7_relativeSplatPath: true }}>
        <div className="min-h-screen bg-surface">
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginForm />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<RouteFallback />}>
                    <MainLayout />
                  </Suspense>
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="sales" element={<SalesPage />} />
              <Route path="cashier" element={<CashierPage />} />
              <Route path="cash-register" element={<CashRegisterPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="purchasing" element={<PurchaseOrdersPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="printers" element={<PrintersPage />} />
              <Route path="zra-sync" element={<ZraSyncPage />} />
            </Route>

            {/* Catch all redirect */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
