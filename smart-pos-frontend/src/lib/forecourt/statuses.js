/**
 * Forecourt status constants — kept byte-identical to the Prisma enums in
 * smart-pos-backend/prisma/schema.prisma (the Forecourt module block). That
 * schema is the source of truth; if these ever drift, the schema wins.
 *
 * Three independent status dimensions on a FuelTransaction, deliberately
 * never collapsed into one: a row can be DISPENSED and SETTLED while still
 * FISCAL_STATUS.PENDING.
 */

export const FUEL_OPERATIONAL_STATUS = Object.freeze({
  DISPENSED: 'DISPENSED',
});

export const FISCAL_STATUS = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  FISCALIZED: 'FISCALIZED',
  FAILED: 'FAILED',
  SUMMARY_PENDING: 'SUMMARY_PENDING',
  SUMMARY_FISCALIZED: 'SUMMARY_FISCALIZED',
});

export const SETTLEMENT_STATUS = Object.freeze({
  UNSETTLED: 'UNSETTLED',
  PARTIALLY_SETTLED: 'PARTIALLY_SETTLED',
  SETTLED: 'SETTLED',
  EXCEPTION: 'EXCEPTION',
});

export const CUSTOMER_TYPE = Object.freeze({
  B2B: 'B2B',
  B2C: 'B2C',
});

export const ATTENDANT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

export const PUMP_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  MAINTENANCE: 'MAINTENANCE',
});
