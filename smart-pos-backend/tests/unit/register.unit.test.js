import { describe, it, expect, afterEach } from 'vitest';
import testData from '../helpers/testData.js';
import register from '../../lib/register.js';

const { createTestBranch, cleanupTestData, DEFAULT_BRANCH_CODE } = testData;
const { createRegister, listRegisters, updateRegister, createTill, listTills, getTill, updateTill } = register;

describe('lib/register — Register/Till CRUD', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('createRegister requires code, name, and a real branch', async () => {
    await createTestBranch();
    await expect(createRegister({ name: 'X', branchId: DEFAULT_BRANCH_CODE })).rejects.toMatchObject({ status: 400 });
    await expect(createRegister({ code: 'TEST-REG-1', branchId: DEFAULT_BRANCH_CODE })).rejects.toMatchObject({
      status: 400,
    });
    await expect(createRegister({ code: 'TEST-REG-1', name: 'X', branchId: 'NOT-A-BRANCH' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('creates a register and lists it, defaulting to active-only', async () => {
    await createTestBranch();
    const reg = await createRegister({ code: 'TEST-REG-A', name: 'Front Counter', branchId: DEFAULT_BRANCH_CODE });
    expect(reg.isActive).toBe(true);

    const active = await listRegisters({ branchId: DEFAULT_BRANCH_CODE });
    expect(active.map((r) => r.id)).toContain(reg.id);

    await updateRegister(reg.id, { isActive: false });
    const stillActive = await listRegisters({ branchId: DEFAULT_BRANCH_CODE });
    expect(stillActive.map((r) => r.id)).not.toContain(reg.id);
    const withInactive = await listRegisters({ branchId: DEFAULT_BRANCH_CODE, includeInactive: true });
    expect(withInactive.map((r) => r.id)).toContain(reg.id);
  });

  it('createTill requires a real register and a non-negative defaultOpeningFloat', async () => {
    await createTestBranch();
    const reg = await createRegister({ code: 'TEST-REG-B', name: 'Reg B', branchId: DEFAULT_BRANCH_CODE });

    await expect(createTill({ code: 'TEST-TILL-1', name: 'X', registerId: 'not-real' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      createTill({ code: 'TEST-TILL-1', name: 'X', registerId: reg.id, defaultOpeningFloat: -5 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('creates a till under a register with its own default opening float', async () => {
    await createTestBranch();
    const reg = await createRegister({ code: 'TEST-REG-C', name: 'Reg C', branchId: DEFAULT_BRANCH_CODE });
    const till = await createTill({
      code: 'TEST-TILL-C1',
      name: 'Till C1',
      registerId: reg.id,
      defaultOpeningFloat: 500,
    });

    expect(till.defaultOpeningFloat).toBe(500);
    const fetched = await getTill(till.id);
    expect(fetched.register.id).toBe(reg.id);

    const tills = await listTills({ registerId: reg.id });
    expect(tills.map((t) => t.id)).toContain(till.id);
  });

  it('different registers/tills can have different opening floats — no shared global default', async () => {
    await createTestBranch();
    const regA = await createRegister({ code: 'TEST-REG-D', name: 'Reg D', branchId: DEFAULT_BRANCH_CODE });
    const regB = await createRegister({ code: 'TEST-REG-E', name: 'Reg E', branchId: DEFAULT_BRANCH_CODE });
    const tillA = await createTill({ code: 'TEST-TILL-D1', name: 'A', registerId: regA.id, defaultOpeningFloat: 200 });
    const tillB = await createTill({ code: 'TEST-TILL-E1', name: 'B', registerId: regB.id, defaultOpeningFloat: 750 });

    expect(tillA.defaultOpeningFloat).toBe(200);
    expect(tillB.defaultOpeningFloat).toBe(750);

    await updateTill(tillA.id, { defaultOpeningFloat: 300 });
    const refetchedA = await getTill(tillA.id);
    const refetchedB = await getTill(tillB.id);
    expect(refetchedA.defaultOpeningFloat).toBe(300);
    expect(refetchedB.defaultOpeningFloat).toBe(750); // untouched by A's change
  });

  it('getTill 404s for a non-existent till', async () => {
    await expect(getTill('not-real')).rejects.toMatchObject({ status: 404 });
  });
});
