const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    console.log('🔍 Checking database connection...');
    
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    
    // Check if users table exists and has data
    const userCount = await prisma.user.count();
    console.log(`📊 Found ${userCount} users in database`);
    
    if (userCount === 0) {
      console.log('⚠️  No users found. Creating test users...');
      
      // Create admin user
      const adminPassword = await bcrypt.hash('admin123', 10);
      const admin = await prisma.user.create({
        data: {
          email: 'admin@smartpos.com',
          name: 'Admin User',
          password: adminPassword,
          role: 'ADMIN'
        }
      });
      console.log(`✅ Created admin user: ${admin.email}`);
      
      // Create cashier user
      const cashierPassword = await bcrypt.hash('cashier123', 10);
      const cashier = await prisma.user.create({
        data: {
          email: 'cashier@smartpos.com',
          name: 'Cashier User',
          password: cashierPassword,
          role: 'CASHIER'
        }
      });
      console.log(`✅ Created cashier user: ${cashier.email}`);
    } else {
      console.log('✅ Users already exist in database');
      
      // List existing users
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true
        }
      });
      
      console.log('👥 Existing users:');
      users.forEach(user => {
        console.log(`   - ${user.email} (${user.role}) - ${user.isActive ? 'Active' : 'Inactive'}`);
      });
    }
    
    console.log('🎉 Database check completed successfully!');
    
  } catch (error) {
    console.error('❌ Database check failed:', error.message);
    console.error('🔧 Possible solutions:');
    console.error('   1. Run: npx prisma migrate dev');
    console.error('   2. Run: npx prisma db seed');
    console.error('   3. Check your DATABASE_URL in .env');
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
