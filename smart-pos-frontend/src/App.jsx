import React, { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginForm from './components/auth/LoginForm';
import ProtectedRoute from './components/auth/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';
import { getHomeRoute } from './lib/roleHome';

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
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const RolesPage = lazy(() => import('./pages/RolesPage'));

// The default landing route and the catch-all fallback both need to depend
// on who's logged in — a CASHIER has no Dashboard workspace at all (see
// MainLayout's NAV_ITEMS), so both must resolve to /cashier for them and
// /dashboard for everyone else, never a hard-coded /dashboard.
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={getHomeRoute(user?.role)} replace />;
}

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
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomeRedirect />} />
              <Route
                path="dashboard"
                element={
                  <ProtectedRoute requiredRole={['SUPERVISOR', 'MANAGER', 'ADMIN', 'VIEWER']}>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="sales"
                element={
                  <ProtectedRoute requiredPermission={['sales:read', 'sales:refund']}>
                    <SalesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="cashier"
                element={
                  <ProtectedRoute requiredPermission={['sales:write', 'sales:read']}>
                    <CashierPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="cash-register"
                element={
                  <ProtectedRoute requiredPermission={['shifts:operate', 'shifts:reconcile', 'shifts:viewAll']}>
                    <CashRegisterPage />
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
              <Route
                path="inventory"
                element={
                  <ProtectedRoute requiredPermission="inventory:read">
                    <InventoryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="customers"
                element={
                  <ProtectedRoute requiredPermission="customers:read">
                    <CustomersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="suppliers"
                element={
                  <ProtectedRoute requiredPermission="suppliers:read">
                    <SuppliersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="purchasing"
                element={
                  <ProtectedRoute requiredPermission="purchasing:read">
                    <PurchaseOrdersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports"
                element={
                  <ProtectedRoute requiredPermission="reports:read">
                    <ReportsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="users"
                element={
                  <ProtectedRoute requiredPermission="users:read">
                    <UsersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="settings"
                element={
                  <ProtectedRoute requiredPermission="settings:read">
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="printers"
                element={
                  <ProtectedRoute requiredPermission="settings:read">
                    <PrintersPage />
                  </ProtectedRoute>
                }
              />
              {/* zra:read, deliberately not zra:status — the lightweight
                  connectivity permission every till holds must never open
                  this page. */}
              <Route
                path="zra-sync"
                element={
                  <ProtectedRoute requiredPermission="zra:read">
                    <ZraSyncPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="roles"
                element={
                  <ProtectedRoute requiredPermission="roles:manage">
                    <RolesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="audit"
                element={
                  <ProtectedRoute requiredPermission="audit:read">
                    <AuditLogPage />
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Catch all redirect */}
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
