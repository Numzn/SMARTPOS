/**
 * Register all products with mock VSDC and mark zraRegistrationStatus=REGISTERED.
 * Usage: node scripts/register-seed-products.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { PrismaClient } = require('@prisma/client');
const { registerProductWithVsdc } = require('../lib/productRegistration');

const prisma = new PrismaClient();

async function main() {
  console.log('=== Register seed products with VSDC ===\n');

  const products = await prisma.product.findMany({
    orderBy: { sku: 'asc' },
  });

  if (products.length === 0) {
    console.log('No products found. Run seed-inventory.js first.');
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;

  for (const product of products) {
    if (!product.zraClassificationCode && !product.zraItemClassification) {
      console.log(`[SKIP] ${product.sku} — missing classification code`);
      failed += 1;
      continue;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: {
        zraItemClassification:
          product.zraItemClassification || product.zraClassificationCode,
        zraPackageUnit: product.zraPackageUnit || product.unit || 'EA',
        zraQuantityUnit: product.zraQuantityUnit || product.unit || 'EA',
        unit: product.unit || 'EA',
      },
    });

    const result = await registerProductWithVsdc(product.id);
    if (result.success) {
      console.log(`[OK] ${product.sku} registered`);
      ok += 1;
    } else {
      console.log(`[FAIL] ${product.sku}: ${result.error}`);
      failed += 1;
    }
  }

  console.log(`\n=== Done: ${ok} registered, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
