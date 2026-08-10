/**
 * Recovers the real ZRA rcptSign/intrlData pair for sales and refunds fiscalized
 * before the A2 fix, when lib/saleFiscal.js (and saleRefund.js) wrote
 * `rcptSign: zra.intrlData || zra.rcptSign` — collapsing both VSDC fields into
 * one column and discarding the true signature.
 *
 * The retained vsdcResponse JSON (Sale.vsdcResponse / Refund.vsdcResponse) is
 * the gateway's mapped response, which already carries rcptSign and intrlData
 * as distinct fields — so historical rows are recoverable from it directly.
 *
 * Dry-run by default; pass --apply to write. Usage:
 *   node scripts/backfill-fiscal-signatures.js
 *   node scripts/backfill-fiscal-signatures.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function extractSignaturePair(vsdcResponse) {
  if (!vsdcResponse || typeof vsdcResponse !== 'object') return null;
  const data =
    vsdcResponse.data && typeof vsdcResponse.data === 'object' ? vsdcResponse.data : vsdcResponse;
  if (!data.rcptSign) return null;
  return { rcptSign: data.rcptSign, intrlData: data.intrlData ?? null };
}

async function backfill(model, label, apply = APPLY) {
  const rows = await model.findMany({
    where: { rcptSign: { not: null }, intrlData: null },
    select: { id: true, rcptSign: true, vsdcResponse: true },
  });

  let recovered = 0;
  let unrecoverable = 0;

  for (const row of rows) {
    const pair = extractSignaturePair(row.vsdcResponse);
    if (!pair) {
      unrecoverable += 1;
      console.log(`[${label}] ${row.id}: no recoverable rcptSign in vsdcResponse — left untouched`);
      continue;
    }

    console.log(
      `[${label}] ${row.id}: rcptSign "${row.rcptSign}" -> "${pair.rcptSign}", intrlData -> "${pair.intrlData}"`
    );

    if (apply) {
      await model.update({
        where: { id: row.id },
        data: { rcptSign: pair.rcptSign, intrlData: pair.intrlData },
      });
    }
    recovered += 1;
  }

  return { total: rows.length, recovered, unrecoverable };
}

async function main() {
  console.log(`=== Fiscal signature backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const sales = await backfill(prisma.sale, 'Sale');
  const refunds = await backfill(prisma.refund, 'Refund');

  console.log('\n=== Summary ===');
  console.log(`Sales:   ${sales.recovered}/${sales.total} recovered, ${sales.unrecoverable} unrecoverable`);
  console.log(`Refunds: ${refunds.recovered}/${refunds.total} recovered, ${refunds.unrecoverable} unrecoverable`);

  if (!APPLY && sales.total + refunds.total > 0) {
    console.log('\nDry run only — re-run with --apply to write these changes.');
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { extractSignaturePair, backfill };
