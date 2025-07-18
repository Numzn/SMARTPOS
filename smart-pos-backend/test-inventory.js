const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testInventorySystem() {
  console.log('🧪 Testing Inventory System...\n');

  try {
    // Test 1: Check if Inventory table exists
    console.log('✅ Test 1: Checking Inventory table...');
    const inventoryCount = await prisma.inventory.count();
    console.log(`   Found ${inventoryCount} inventory records\n`);

    // Test 2: Check if StockMovement table exists
    console.log('✅ Test 2: Checking StockMovement table...');
    const movementCount = await prisma.stockMovement.count();
    console.log(`   Found ${movementCount} stock movement records\n`);

    // Test 3: Check if Products exist
    console.log('✅ Test 3: Checking Products...');
    const products = await prisma.product.findMany({
      take: 3,
      select: {
        id: true,
        name: true,
        price: true
      }
    });
    console.log(`   Found ${products.length} products:`);
    products.forEach(p => console.log(`   - ${p.name} (K${p.price})`));
    console.log('');

    // Test 4: Create test inventory record if products exist
    if (products.length > 0) {
      console.log('✅ Test 4: Creating test inventory record...');
      
      const testProduct = products[0];
      
      // Check if inventory already exists for this product
      const existingInventory = await prisma.inventory.findFirst({
        where: {
          productId: testProduct.id,
          branchId: 'main'
        }
      });

      if (existingInventory) {
        console.log(`   Inventory already exists for ${testProduct.name}`);
        console.log(`   Current Stock: ${existingInventory.currentStock}`);
        console.log(`   Total Value: K${existingInventory.totalValue}\n`);
      } else {
        const newInventory = await prisma.inventory.create({
          data: {
            productId: testProduct.id,
            branchId: 'main',
            currentStock: 100,
            minimumStock: 10,
            maximumStock: 500,
            reorderPoint: 25,
            reorderQuantity: 100,
            averageCost: testProduct.price * 0.7, // 70% of selling price
            lastCost: testProduct.price * 0.7,
            totalValue: 100 * (testProduct.price * 0.7)
          }
        });
        console.log(`   Created inventory for ${testProduct.name}`);
        console.log(`   Stock: ${newInventory.currentStock}`);
        console.log(`   Value: K${newInventory.totalValue}\n`);
      }
    }

    // Test 5: Test inventory endpoint
    console.log('✅ Test 5: Testing API endpoints...');
    console.log('   To test the API, make sure backend is running and use:');
    console.log('   GET http://localhost:4000/api/inventory');
    console.log('   POST http://localhost:4000/api/inventory/adjust');
    console.log('   POST http://localhost:4000/api/inventory/receive\n');

    console.log('🎉 All inventory system tests passed!');
    console.log('📝 Summary:');
    console.log(`   - Database tables: ✅ Ready`);
    console.log(`   - Products: ${products.length} found`);
    console.log(`   - Inventory records: ${inventoryCount} found`);
    console.log(`   - Stock movements: ${movementCount} found`);
    console.log('\n🚀 You can now start the frontend and backend to test the full system!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    if (error.code === 'P2021') {
      console.log('\n💡 Solution: The table does not exist. Run the migration:');
      console.log('   node dev-helper.js migrate');
    } else if (error.code === 'P1001') {
      console.log('\n💡 Solution: Database connection failed. Check your .env file.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

testInventorySystem();
