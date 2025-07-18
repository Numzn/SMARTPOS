const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function quickCheck() {
  try {
    console.log('🔍 Quick database check...');
    
    // Check if we can connect
    await prisma.$connect();
    console.log('✅ Database connected');
    
    // Check users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    });
    
    console.log(`📊 Found ${users.length} users:`);
    users.forEach(user => {
      console.log(`   - ${user.email} (${user.role}) - ${user.isActive ? 'Active' : 'Inactive'}`);
    });
    
    if (users.length === 0) {
      console.log('🚨 No users found! Creating admin user...');
      
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = await prisma.user.create({
        data: {
          email: 'admin@smartpos.com',
          name: 'Admin User',
          password: hashedPassword,
          role: 'ADMIN',
          isActive: true
        }
      });
      
      console.log(`✅ Created admin: ${admin.email}`);
    }
    
    // Test login process
    console.log('🔐 Testing login process...');
    const testUser = await prisma.user.findUnique({
      where: { email: 'admin@smartpos.com' }
    });
    
    if (testUser) {
      const passwordMatch = await bcrypt.compare('admin123', testUser.password);
      console.log(`🔑 Password verification: ${passwordMatch ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`👤 User active: ${testUser.isActive ? '✅ YES' : '❌ NO'}`);
    } else {
      console.log('❌ Admin user not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

quickCheck();
