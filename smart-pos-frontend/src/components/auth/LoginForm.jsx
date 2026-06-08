import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { API_ROOT } from '../../lib/apiClient';
import { Server, AlertCircle, Loader2 } from 'lucide-react';

const API_DISPLAY = API_ROOT.replace(/^https?:\/\//, '');

const LoginForm = () => {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: 'admin@smartpos.com',
    password: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');

  useEffect(() => {
    api
      .get('/api/health')
      .then(() => setApiStatus('online'))
      .catch(() => setApiStatus('offline'));
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    const result = await login(formData.email, formData.password);
    if (result.success) {
      navigate('/dashboard', { replace: true });
    } else {
      setError(result.error);
    }
    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-surface">
      <div className="hidden lg:flex lg:w-[42%] bg-surface-sidebar text-gray-400 flex-col justify-between p-8">
        <div>
          <div className="text-white text-lg font-semibold tracking-tight">Smart POS</div>
          <div className="text-[10px] uppercase tracking-widest mt-1 text-gray-500">
            Point of Sale · Zambia
          </div>
        </div>
        <div className="space-y-4 text-sm">
          <p className="text-gray-500 leading-relaxed">
            Embedded retail terminal. Inventory, sales, and ZRA smart invoice compliance in one
            system.
          </p>
          <div className="font-mono text-xs text-gray-600 border border-white/10 rounded p-3 bg-black/20">
            <div>API · {API_DISPLAY}</div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`status-dot ${
                  apiStatus === 'online' ? 'bg-emerald-500' : apiStatus === 'offline' ? 'bg-red-500' : 'bg-amber-500'
                }`}
              />
              {apiStatus === 'online' && 'Service online'}
              {apiStatus === 'offline' && 'Service offline'}
              {apiStatus === 'checking' && 'Checking…'}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-600">ZRA VSDC compliant · v2.0</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-6">
            <h1 className="text-lg font-semibold text-gray-900">Smart POS</h1>
            <p className="text-xs text-gray-500">Sign in to continue</p>
          </div>

          {apiStatus === 'offline' && (
            <div className="mb-4 flex gap-2 p-3 border border-amber-300 bg-amber-50 text-amber-900 text-xs rounded">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Backend offline.</strong> Run{' '}
                <code className="font-mono bg-amber-100/80 px-1">npm run dev</code> in{' '}
                <code className="font-mono bg-amber-100/80 px-1">smart-pos-backend</code>.
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="panel">
            <div className="panel-header">
              <h2 className="text-sm font-semibold text-gray-900">Operator login</h2>
            </div>
            <div className="panel-body space-y-4">
              {error && (
                <div className="flex gap-2 p-2 border border-red-200 bg-red-50 text-red-800 text-xs rounded">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label htmlFor="email" className="label-sys">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  className="input-sys"
                />
              </div>

              <div>
                <label htmlFor="password" className="label-sys">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="input-sys"
                />
              </div>

              <button type="submit" disabled={isSubmitting || apiStatus === 'offline'} className="btn-primary w-full py-2">
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Authenticating…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </div>
          </form>

          <p className="mt-4 text-center text-[11px] text-gray-500 flex items-center justify-center gap-1">
            <Server className="w-3 h-3" />
            Default: admin@smartpos.com / admin123
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
