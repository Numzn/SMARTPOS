import React from 'react';
import { Monitor } from 'lucide-react';

/**
 * V1 register/till model — shown once per device (remembered afterward via
 * localStorage, see useRegisterShiftInit) when more than one register/till
 * exists at this branch and none has been picked yet for this machine.
 */
const RegisterSelectPrompt = ({ registers, onSelect, error }) => {
  const tills = registers.flatMap((r) => r.tills.map((t) => ({ ...t, registerName: r.name, registerCode: r.code })));

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-xl border shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-900">
          <Monitor className="w-5 h-5" strokeWidth={1.75} />
          <h2 className="text-lg font-semibold">Select This Till</h2>
        </div>
        <p className="text-sm text-gray-500">
          This device isn&apos;t linked to a register yet. Pick which till you&apos;re working on — this only
          needs to be done once per device.
        </p>

        <div className="space-y-2">
          {tills.map((till) => (
            <button
              key={till.id}
              type="button"
              onClick={() => onSelect(till)}
              className="w-full text-left px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 hover:border-blue-400"
            >
              <div className="text-sm font-medium text-gray-900">{till.registerName}</div>
              <div className="text-xs text-gray-500">
                {till.registerCode} · {till.name}
              </div>
            </button>
          ))}
        </div>

        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>}
      </div>
    </div>
  );
};

export default RegisterSelectPrompt;
