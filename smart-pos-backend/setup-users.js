const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function setupUsers() {
  console.log('🚀 Setting up Smart POS users...\n');
  
  try {
    // Check connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    // Clear existing users
    await prisma.user.deleteMany();
    console.log('🧹 Cleared existing users');
    
    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.create({
      data: {
        email: 'admin@smartpos.com',
        name: 'System Admin',
        password: adminPassword,
        role: 'ADMIN',
        isActive: true,
      }
    });
    console.log('👤 Created admin user:', {
      id: admin.id,
      email: admin.email,
      role: admin.role
    });
    
    // Create cashier user
    const cashierPassword = await bcrypt.hash('cashier123', 10);
    const cashier = await prisma.user.create({
      data: {
        email: 'cashier@smartpos.com',
        name: 'Cashier User',
        password: cashierPassword,
        role: 'CASHIER',
        isActive: true,
      }
    });
    console.log('👤 Created cashier user:', {
      id: cashier.id,
      email: cashier.email,
      role: cashier.role
    });
    
    // Test password verification
    console.log('\n🔐 Testing password verification...');
    const adminCheck = await bcrypt.compare('admin123', admin.password);
    const cashierCheck = await bcrypt.compare('cashier123', cashier.password);
    
    console.log('✅ Admin password verification:', adminCheck ? 'PASS' : 'FAIL');
    console.log('✅ Cashier password verification:', cashierCheck ? 'PASS' : 'FAIL');
    
    // Create some sample categories and products
    console.log('\n📦 Setting up sample data...');
    
    const category1 = await prisma.category.create({
      data: {
        name: 'Electronics',
        description: 'Electronic devices and accessories'
      }
    });
    
    const category2 = await prisma.category.create({
      data: {
        name: 'Food & Beverages',
        description: 'Food items and drinks'
      }
    });
    
    console.log('📂 Created categories');
    
    // Create sample products
    await prisma.product.createMany({
      data: [
        {
          name: 'iPhone 15',
          description: 'Latest Apple smartphone',
          price: 999.99,
          cost: 800.00,
          sku: 'IPH15-001',
          barcode: '1234567890123',
          stock: 10,
          categoryId: category1.id,
          isActive: true
        },
        {
          name: 'Samsung Galaxy S24',
          description: 'Samsung flagship phone',
          price: 899.99,
          cost: 700.00,
          sku: 'SGS24-001',
          barcode: '1234567890124',
          stock: 15,
          categoryId: category1.id,
          isActive: true
        },
        {
          name: 'Coca Cola 500ml',
          description: 'Refreshing soft drink',
          price: 2.50,
          cost: 1.20,
          sku: 'CC500-001',
          barcode: '1234567890125',
          stock: 100,
          categoryId: category2.id,
          isActive: true
        }
      ]
    });
    
    console.log('🛍️ Created sample products');
    
    // Summary
    const userCount = await prisma.user.count();
    const productCount = await prisma.product.count();
    const categoryCount = await prisma.category.count();
    
    console.log('\n✅ Setup complete!');
    console.log(`📊 Summary:`);
    console.log(`   Users: ${userCount}`);
    console.log(`   Categories: ${categoryCount}`);
    console.log(`   Products: ${productCount}`);
    
    console.log('\n🔑 Login credentials:');
    console.log('   Admin: admin@smartpos.com / admin123');
    console.log('   Cashier: cashier@smartpos.com / cashier123');
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupUsers();
