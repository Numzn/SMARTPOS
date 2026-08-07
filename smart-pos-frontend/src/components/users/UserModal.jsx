import React from 'react';
import Modal from '../ui/Modal';
import { TextField, SelectField } from '../ui/Field';
import { ROLES, ROLE_DESCRIPTIONS } from '../../services/userService';

const EMPTY_USER = { name: '', email: '', password: '', role: 'CASHIER' };

const UserModal = ({ showModal, setShowModal, isEdit, userData, setUserData, errors, loading, onSubmit }) => {
  const handleClose = () => {
    setShowModal(false);
    setUserData(EMPTY_USER);
  };

  const set = (key) => (e) => setUserData({ ...userData, [key]: e.target.value });

  return (
    <Modal
      open={showModal}
      onClose={handleClose}
      title={isEdit ? 'Edit User' : 'Add User'}
      description={
        isEdit
          ? 'Email cannot be changed. To give someone a new password, use Reset Password.'
          : undefined
      }
      size="md"
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add User'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" required value={userData.name} onChange={set('name')} error={errors?.name} />

        {/* The backend keys accounts on email and offers no change-email route,
            so editing it here would silently do nothing. */}
        <TextField
          label="Email"
          required={!isEdit}
          type="email"
          value={userData.email}
          onChange={set('email')}
          error={errors?.email}
          disabled={isEdit}
          hint={isEdit ? 'Email cannot be changed after the account is created' : undefined}
        />

        {!isEdit && (
          <TextField
            label="Password"
            required
            type="password"
            value={userData.password}
            onChange={set('password')}
            error={errors?.password}
            hint="At least 8 characters. The user can change it after signing in."
          />
        )}

        <SelectField label="Role" required value={userData.role} onChange={set('role')} error={errors?.role}>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </SelectField>

        <p className="text-xs text-gray-500 -mt-2">{ROLE_DESCRIPTIONS[userData.role]}</p>
      </div>
    </Modal>
  );
};

export default UserModal;
export { EMPTY_USER };
