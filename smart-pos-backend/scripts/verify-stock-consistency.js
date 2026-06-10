/**
 * Compare inventory.currentStock vs sum of ACTIVE batch quantities per product.
 * Manual run only — do not wire to CI until stable.
 *
 * Usage: node scripts/verify-stock-consistency.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BRANCH = process.env.DEFAULT_BRANCH || 'main';

async function main() {
  console.log(`=== Stock consistency check (branch: ${BRANCH}) ===\n`);

  const products = await prisma.product.findMany({
    orderBy: { sku: 'asc' },
    include: {
      inventory: { where: { branchId: BRANCH } },
      InventoryItem: {
        where: {
          status: 'ACTIVE',
          quantity: { gt: 0 },
          inventory: { branchId: BRANCH },
        },
        select: { quantity: true },
      },
    },
  });

  let driftCount = 0;

  for (const product of products) {
    const currentStock = product.inventory[0]?.currentStock ?? 0;
    const batchSum = product.InventoryItem.reduce((sum, b) => sum + b.quantity, 0);
    const delta = currentStock - batchSum;
    const ok = delta === 0;

    if (!ok) driftCount += 1;

    const status = ok ? 'OK' : 'DRIFT';
    const deltaStr = ok ? '' : ` (delta ${delta > 0 ? '+' : ''}${delta})`;
    console.log(
      `[${status}] ${product.sku.padEnd(10)} currentStock=${currentStock} batchSum=${batchSum}${deltaStr}`
    );
  }

  console.log(`\n=== Summary: ${products.length} products, ${driftCount} drift(s) ===`);

  if (driftCount > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
