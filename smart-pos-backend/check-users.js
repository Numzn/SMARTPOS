const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUsers() {
  try {
    console.log('Checking users in database...');
    
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true
      }
    });
    
    console.log(`Found ${users.length} users:`);
    users.forEach(user => {
      console.log(`- ${user.email} (${user.role}) - Active: ${user.isActive}`);
    });
    
    // Try to find the specific admin user
    const admin = await prisma.user.findUnique({
      where: { email: 'admin@smartpos.com' }
    });
    
    if (admin) {
      console.log('\n✅ Admin user found:');
      console.log(`Email: ${admin.email}`);
      console.log(`Name: ${admin.name}`);
      console.log(`Role: ${admin.role}`);
      console.log(`Active: ${admin.isActive}`);
      console.log(`Password hash length: ${admin.password.length}`);
    } else {
      console.log('\n❌ Admin user NOT found');
    }
    
  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
