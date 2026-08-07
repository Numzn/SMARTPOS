import React, { useState, useEffect, useCallback } from 'react';
import UserModal, { EMPTY_USER } from '../components/users/UserModal';
import UsersTable from '../components/users/UsersTable';
import ResetPasswordModal from '../components/users/ResetPasswordModal';
import { userApi } from '../services/userService';
import { usePermissions } from '../hooks/usePermissions';

const UsersPage = () => {
  const { user: currentUser, hasRole } = usePermissions();
  // Every endpoint behind this page is requireRole('ADMIN') server-side, so a
  // non-admin is shown the boundary rather than a page of actions that would
  // all come back 403.
  const isAdmin = hasRole('ADMIN');

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [showUserModal, setShowUserModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [userData, setUserData] = useState(EMPTY_USER);
  const [errors, setErrors] = useState({});

  const [resetTarget, setResetTarget] = useState(null);
  const [issuedPassword, setIssuedPassword] = useState('');

  const load = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setUsers(await userApi.fetchUsers());
    } catch (err) {
      setError(err?.data?.error || err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const validate = () => {
    const next = {};
    if (!userData.name?.trim()) next.name = 'Name is required';
    if (!isEdit) {
      if (!userData.email?.trim()) next.email = 'Email is required';
      if (!userData.password || userData.password.length < 8) {
        next.password = 'Password must be at least 8 characters';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const run = async (fn, failureMessage) => {
    setSaving(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(`${failureMessage}: ${err?.data?.error || err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    if (!validate()) return;
    return run(async () => {
      if (isEdit) {
        await userApi.updateUser(editingId, { name: userData.name, role: userData.role });
      } else {
        await userApi.createUser(userData);
      }
      setShowUserModal(false);
      setUserData(EMPTY_USER);
    }, isEdit ? 'Could not save user' : 'Could not create user');
  };

  const openCreate = () => {
    setIsEdit(false);
    setEditingId(null);
    setUserData(EMPTY_USER);
    setErrors({});
    setShowUserModal(true);
  };

  const openEdit = (user) => {
    setIsEdit(true);
    setEditingId(user.id);
    setUserData({ name: user.name || '', email: user.email, password: '', role: user.role });
    setErrors({});
    setShowUserModal(true);
  };

  const handleToggleActive = (user) => {
    const deactivating = user.isActive !== false;
    const label = user.name || user.email;
    if (deactivating && !window.confirm(`Deactivate ${label}? They will be signed out and unable to sign in.`)) {
      return;
    }
    return run(
      () => userApi.setActive(user.id, !deactivating ? true : false),
      deactivating ? 'Could not deactivate user' : 'Could not reactivate user'
    );
  };

  const handleResetPassword = (newPassword) =>
    run(async () => {
      const res = await userApi.resetPassword(resetTarget.id, newPassword);
      // The server returns temporaryPassword only when it generated one; it is
      // undefined when the admin supplied the password, in which case they
      // already know it and there is nothing to reveal.
      setIssuedPassword(res?.temporaryPassword || newPassword || '');
    }, 'Could not reset password');

  if (!isAdmin) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Users</h1>
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          User administration is restricted to administrators.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status" aria-label="Loading users" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-600">Accounts, roles and access</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          + Add User
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 flex items-start justify-between gap-3">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="text-sm underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <UsersTable
        users={users}
        currentUserId={currentUser?.id}
        onEdit={openEdit}
        onResetPassword={(user) => {
          setIssuedPassword('');
          setResetTarget(user);
        }}
        onToggleActive={handleToggleActive}
      />

      <UserModal
        showModal={showUserModal}
        setShowModal={setShowUserModal}
        isEdit={isEdit}
        userData={userData}
        setUserData={setUserData}
        errors={errors}
        loading={saving}
        onSubmit={handleSubmit}
      />

      <ResetPasswordModal
        show={Boolean(resetTarget)}
        user={resetTarget}
        onClose={() => {
          setResetTarget(null);
          setIssuedPassword('');
        }}
        loading={saving}
        onSubmit={handleResetPassword}
        issuedPassword={issuedPassword}
      />
    </div>
  );
};

export default UsersPage;
