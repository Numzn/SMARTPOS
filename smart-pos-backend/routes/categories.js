const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticateToken, requirePermission, optionalAuth } = require('../middleware/auth');

// Get all categories (public with optional auth)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        products: {
          select: {
            id: true,
            name: true,
            price: true,
            // stock: true, // Removed because 'stock' is not a valid field in the Product model
            isActive: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get category by ID
// Get category by ID (public with optional auth)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: {
        products: true
      }
    });
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// Create new category
// Create new category (requires categories:write permission)
router.post('/', authenticateToken, requirePermission('categories:write'), async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const category = await prisma.category.create({
      data: { 
        name,
        description
      }
    });
    
    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category
// Update category (requires categories:write permission)
router.put('/:id', authenticateToken, requirePermission('categories:write'), async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: { 
        name,
        description
      }
    });
    
    res.json(category);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
// Delete category (requires categories:delete permission)
router.delete('/:id', authenticateToken, requirePermission('categories:delete'), async (req, res) => {
  try {
    // Check if category has products
    const productsCount = await prisma.product.count({
      where: { categoryId: req.params.id }
    });
    
    if (productsCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete category with existing products. Please reassign or delete products first.' 
      });
    }
    
    await prisma.category.delete({
      where: { id: req.params.id }
    });
    
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;
