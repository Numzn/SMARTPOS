const { PrismaClient } = require('@prisma/client');

// Test different connection approaches
async function testConnection() {
  console.log('🔍 Testing database connection...\n');
  
  // Test 1: Basic Prisma connection
  console.log('Test 1: Basic Prisma connection');
  const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });
  
  try {
    await prisma.$connect();
    console.log('✅ Prisma connection successful');
    
    // Test 2: Simple query
    console.log('\nTest 2: Simple database query');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Database query successful:', result);
    
    // Test 3: Check if users table exists
    console.log('\nTest 3: Check users table');
    try {
      const userCount = await prisma.user.count();
      console.log(`✅ Users table exists with ${userCount} records`);
      
      // Test 4: List existing users
      if (userCount > 0) {
        console.log('\nTest 4: Existing users:');
        const users = await prisma.user.findMany({
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true
          }
        });
        console.table(users);
      }
    } catch (tableError) {
      console.log('❌ Users table might not exist:', tableError.message);
      
      // Try to run migrations
      console.log('\nAttempting to run migrations...');
      const { execSync } = require('child_process');
      try {
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
        console.log('✅ Migrations completed');
      } catch (migrationError) {
        console.log('❌ Migration failed:', migrationError.message);
      }
    }
    
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('\nTroubleshooting steps:');
    console.log('1. Check your internet connection');
    console.log('2. Verify Supabase project is running');
    console.log('3. Check DATABASE_URL in .env file');
    console.log('4. Try using DIRECT_URL instead');
    
    // Test with direct URL
    console.log('\nTrying direct connection...');
    if (process.env.DIRECT_URL && process.env.DIRECT_URL !== process.env.DATABASE_URL) {
      const directPrisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DIRECT_URL
          }
        }
      });
      
      try {
        await directPrisma.$connect();
        console.log('✅ Direct connection successful');
        await directPrisma.$disconnect();
      } catch (directError) {
        console.log('❌ Direct connection also failed:', directError.message);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Alternative: Test with manual PostgreSQL connection
async function testManualConnection() {
  console.log('\n🔍 Testing manual PostgreSQL connection...');
  
  try {
    // Parse the DATABASE_URL
    const dbUrl = process.env.DATABASE_URL;
    console.log('Database URL pattern:', dbUrl ? dbUrl.substring(0, 50) + '...' : 'Not set');
    
    // Try pg directly
    const { Client } = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    await client.connect();
    console.log('✅ PostgreSQL direct connection successful');
    
    const result = await client.query('SELECT NOW()');
    console.log('✅ Query successful:', result.rows[0]);
    
    await client.end();
    
  } catch (error) {
    console.log('❌ Manual connection failed:', error.message);
    
    // If pg is not installed, suggest it
    if (error.message.includes('Cannot find module')) {
      console.log('\n💡 Installing pg module...');
      const { execSync } = require('child_process');
      try {
        execSync('npm install pg', { stdio: 'inherit' });
        console.log('✅ pg module installed. Please run this script again.');
      } catch (installError) {
        console.log('❌ Failed to install pg module');
      }
    }
  }
}

// Main execution
async function main() {
  require('dotenv').config();
  
  console.log('Environment check:');
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
  console.log('DIRECT_URL set:', !!process.env.DIRECT_URL);
  console.log('');
  
  await testConnection();
  await testManualConnection();
}

main().catch(console.error);
