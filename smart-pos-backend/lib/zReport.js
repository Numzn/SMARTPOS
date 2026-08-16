/**
 * The immutable Z-report artifact — persistence only. What goes into it
 * (the actual totals/aggregation) is computed by lib/shift.js's
 * buildZReportTotals(), colocated there alongside computeExpectedCash() and
 * getShiftReport() since they share the same aggregation queries. This
 * module just owns allocating the sequential Z number and writing the frozen
 * row — deliberately thin, and deliberately does not require lib/shift.js
 * (which requires this module for endShift()), to avoid a circular require.
 */

const { nextSequentialNumber } = require('./sequentialNumber');

/**
 * `tx` must be an active transaction — a Z report is always created inside
 * the same transaction as the SHIFT_END approval consumption and the
 * shift's status transition, never standalone.
 */
async function createZReport(tx, shiftId, totals) {
  const zNumber = await nextSequentialNumber(tx, { model: 'zReport', field: 'zNumber', prefix: 'Z' });
  return tx.zReport.create({
    data: {
      shiftId,
      zNumber,
      ...totals,
    },
  });
}

module.exports = { createZReport };
