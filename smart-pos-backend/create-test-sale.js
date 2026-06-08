const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createTestSale() {
  try {
    // Get or create a user
    let user = await prisma.user.findFirst({
      where: { email: 'cashier@smartpos.com' }
    });

    if (!user) {
      console.log('Creating test user...');
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('test123', 10);
      
      user = await prisma.user.create({
        data: {
          email: 'cashier@smartpos.com',
          name: 'Test Cashier',
          password: hashedPassword,
          role: 'CASHIER'
        }
      });
    }

    // Get a product
    const product = await prisma.product.findFirst({
      where: { sku: 'DSL500' }
    });

    if (!product) {
      throw new Error('Product DSL500 not found. Please create it first.');
    }

    // Create a test sale
    console.log('Creating test sale...');
    const sale = await prisma.sale.create({
      data: {
        userId: user.id,
        total: 255.00,
        subtotal: 220.00,
        tax: 35.00,
        paymentMethod: 'CASH',
        status: 'COMPLETED',
        saleItems: {
          create: [
            {
              productId: product.id,
              quantity: 10,
              price: 25.50,
              total: 255.00
            }
          ]
        }
      },
      include: {
        user: true,
        saleItems: {
          include: {
            product: true
          }
        }
      }
    });

    console.log('✅ Test sale created successfully!');
    console.log('📊 Sale Details:');
    console.log(`   - Sale ID: ${sale.id}`);
    console.log(`   - Total: K${sale.total}`);
    console.log(`   - Cashier: ${sale.user.email}`);
    console.log(`   - Items: ${sale.saleItems.length}`);
    console.log('');
    console.log('🧾 Now you can test ZRA integration with:');
    console.log(`   POST http://localhost:4000/api/zra/send-invoice/${sale.id}`);

    return sale;

  } catch (error) {
    console.error('❌ Error creating test sale:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createTestSale();
