const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create default admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@smartpos.com' },
    update: {},
    create: {
      email: 'admin@smartpos.com',
      name: 'Admin User',
      password: adminPassword,
      role: 'ADMIN'
    }
  });

  // Create cashier user
  const cashierPassword = await bcrypt.hash('cashier123', 10);
  const cashier = await prisma.user.upsert({
    where: { email: 'cashier@smartpos.com' },
    update: {},
    create: {
      email: 'cashier@smartpos.com',
      name: 'Cashier User',
      password: cashierPassword,
      role: 'CASHIER'
    }
  });

  // Create categories
  const beveragesCategory = await prisma.category.create({
    data: {
      name: 'Beverages',
      description: 'Soft drinks, juices, and other beverages'
    }
  });

  const snacksCategory = await prisma.category.create({
    data: {
      name: 'Snacks',
      description: 'Chips, crackers, and other snacks'
    }
  });

  const dairyCategory = await prisma.category.create({
    data: {
      name: 'Dairy',
      description: 'Milk, cheese, and dairy products'
    }
  });

  const categories = [beveragesCategory, snacksCategory, dairyCategory];

  // Create sample products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Coca Cola 500ml',
        description: 'Refreshing cola drink',
        price: 2.50,
        cost: 1.50,
        sku: 'COKE500',
        barcode: '123456789012',
        minStockLevel: 10,
        categoryId: categories[0].id,
        taxRate: 16,
        vatCategoryCode: 'STANDARD',
        zraClassificationCode: 'BVRG001'
      }
    }),
    prisma.product.create({
      data: {
        name: 'Lays Chips Original',
        description: 'Classic potato chips',
        price: 3.00,
        cost: 2.00,
        sku: 'LAYS001',
        barcode: '123456789013',
        minStockLevel: 5,
        categoryId: categories[1].id,
        taxRate: 16,
        vatCategoryCode: 'STANDARD',
        zraClassificationCode: 'SNCK001'
      }
    }),
    prisma.product.create({
      data: {
        name: 'Fresh Milk 1L',
        description: 'Fresh whole milk',
        price: 4.50,
        cost: 3.00,
        sku: 'MILK1L',
        barcode: '123456789014',
        minStockLevel: 8,
        categoryId: categories[2].id,
        hasExpiry: true,
        shelfLifeDays: 7,
        taxRate: 16,
        vatCategoryCode: 'STANDARD',
        zraClassificationCode: 'DARY001'
      }
    })
  ]);

  console.log('✅ Database seeded successfully!');
  console.log('📊 Created:');
  console.log(`   - ${categories.length} categories`);
  console.log(`   - ${products.length} products`);
  console.log(`   - 2 users (admin & cashier)`);
  console.log('');
  console.log('🔑 Login credentials:');
  console.log('   Admin: admin@smartpos.com / admin123');
  console.log('   Cashier: cashier@smartpos.com / cashier123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
