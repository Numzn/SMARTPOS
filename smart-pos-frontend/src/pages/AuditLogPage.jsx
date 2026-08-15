import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Filter, RotateCcw } from 'lucide-react';
import { fetchAuditTrail } from '../api/auditApi';
import { userApi } from '../services/userService';
import AuditLogTable from '../components/audit/AuditLogTable';
import Pagination from '../components/ui/Pagination';

// Mirrors services/auditService.js's eventTypes groupings exactly, so the
// filter reads the same way the event types are organized at the source.
// Hardcoded client-side — there's no endpoint enumerating them and they
// change rarely; keep in sync manually if a new event type is added there.
const EVENT_TYPE_GROUPS = [
  {
    label: 'User',
    options: ['USER_LOGIN', 'USER_LOGOUT', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE', 'USER_ZRA_SYNC'],
  },
  {
    label: 'Transaction',
    options: [
      'SALE_CREATE', 'SALE_UPDATE', 'SALE_CANCEL', 'REFUND_CREATE', 'DEBIT_NOTE_CREATE',
      'DISCOUNT_APPROVAL', 'TILL_LINE_REVERSAL', 'TILL_SESSION_ABANDON', 'SUPERVISOR_APPROVAL_GRANTED',
      'INVOICE_GENERATE', 'INVOICE_SUBMIT', 'INVOICE_CANCEL', 'RECEIPT_REPRINT',
    ],
  },
  {
    label: 'Catalog',
    options: [
      'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_DELETE', 'PRODUCT_BULK_REGISTER',
      'ITEM_SYNC', 'PURCHASE_SYNC', 'CATEGORY_CREATE', 'CATEGORY_UPDATE', 'CATEGORY_DELETE',
    ],
  },
  { label: 'Inventory', options: ['STOCK_ADJUSTMENT', 'STOCK_RECEIVE', 'STOCK_SYNC'] },
  { label: 'Cash register / shift', options: ['SHIFT_OPEN', 'SHIFT_CLOSE', 'CASH_MOVEMENT'] },
  {
    label: 'Business management',
    options: [
      'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 'CUSTOMER_ZRA_SYNC',
      'SUPPLIER_CREATE', 'SUPPLIER_UPDATE', 'SUPPLIER_DELETE',
      'PURCHASE_ORDER_CREATE', 'PURCHASE_ORDER_SEND', 'PURCHASE_ORDER_CANCEL', 'PURCHASE_ORDER_RECEIVE',
      'SUPPLIER_RETURN_CREATE',
    ],
  },
  { label: 'Branch', options: ['BRANCH_CREATE', 'BRANCH_UPDATE', 'BRANCH_ZRA_SYNC', 'BRANCH_DELETE'] },
  {
    label: 'System',
    options: ['SYSTEM_START', 'SYSTEM_SHUTDOWN', 'BACKUP_CREATE', 'DATA_EXPORT', 'CONFIG_CHANGE', 'SETTINGS_UPDATE'],
  },
  { label: 'ZRA / VSDC', options: ['VSDC_CONNECT', 'VSDC_DISCONNECT', 'VSDC_AUTH', 'VSDC_SYNC', 'ZRA_SUBMISSION'] },
  {
    label: 'Security',
    options: ['FAILED_LOGIN', 'PERMISSION_DENIED', 'DATA_BREACH_ATTEMPT', 'UNAUTHORIZED_ACCESS'],
  },
];

const LIMIT = 50;

const EMPTY_FILTERS = { eventType: '', userId: '', riskLevel: '', success: '', startDate: '', endDate: '' };

const AuditLogPage = () => {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    userApi.fetchUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAuditTrail({ ...filters, limit: LIMIT, offset });
      setEntries(res.auditTrail || []);
      setTotalCount(res.totalCount || 0);
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load audit trail');
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setOffset(0);
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <History className="w-6 h-6 text-gray-500" strokeWidth={1.5} />
            Audit Log
          </h1>
          <p className="text-gray-600">Tamper-evident trail of actions across the system</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="ml-auto btn btn-ghost !px-2 !py-1 !text-xs">
              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
              Clear
            </button>
          )}
        </div>
        <div className="panel-body grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="label-sys" htmlFor="audit-event-type">Event type</label>
            <select
              id="audit-event-type"
              value={filters.eventType}
              onChange={(e) => updateFilter('eventType', e.target.value)}
              className="input-sys"
            >
              <option value="">All events</option>
              {EVENT_TYPE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div>
            <label className="label-sys" htmlFor="audit-user">User</label>
            <select
              id="audit-user"
              value={filters.userId}
              onChange={(e) => updateFilter('userId', e.target.value)}
              className="input-sys"
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-sys" htmlFor="audit-risk">Risk level</label>
            <select
              id="audit-risk"
              value={filters.riskLevel}
              onChange={(e) => updateFilter('riskLevel', e.target.value)}
              className="input-sys"
            >
              <option value="">Any risk</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          <div>
            <label className="label-sys" htmlFor="audit-success">Outcome</label>
            <select
              id="audit-success"
              value={filters.success}
              onChange={(e) => updateFilter('success', e.target.value)}
              className="input-sys"
            >
              <option value="">Any outcome</option>
              <option value="true">Success</option>
              <option value="false">Failed</option>
            </select>
          </div>

          <div>
            <label className="label-sys" htmlFor="audit-start">From</label>
            <input
              id="audit-start"
              type="date"
              value={filters.startDate}
              onChange={(e) => updateFilter('startDate', e.target.value)}
              className="input-sys"
            />
          </div>

          <div>
            <label className="label-sys" htmlFor="audit-end">To</label>
            <input
              id="audit-end"
              type="date"
              value={filters.endDate}
              onChange={(e) => updateFilter('endDate', e.target.value)}
              className="input-sys"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="panel">
          <div className="panel-body p-10 text-center text-gray-500">Loading…</div>
        </div>
      ) : (
        <div className="panel">
          <AuditLogTable entries={entries} usersById={usersById} />
          <Pagination offset={offset} limit={LIMIT} totalCount={totalCount} onPageChange={setOffset} />
        </div>
      )}
    </div>
  );
};

export default AuditLogPage;
