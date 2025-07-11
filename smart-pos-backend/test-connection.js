const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testConnection() {
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Database connected successfully!');
    
    // Test a simple query
    const userCount = await prisma.user.count();
    const categoryCount = await prisma.category.count();
    const productCount = await prisma.product.count();
    const saleCount = await prisma.sale.count();
    
    console.log('📊 Database Stats:');
    console.log(`   - Users: ${userCount}`);
    console.log(`   - Categories: ${categoryCount}`);
    console.log(`   - Products: ${productCount}`);
    console.log(`   - Sales: ${saleCount}`);
    
    console.log('🎉 Database is ready for your Smart POS system!');
    
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error(error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
