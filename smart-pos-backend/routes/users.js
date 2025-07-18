const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole, requirePermission, sessionManager, PERMISSIONS } = require('../middleware/auth');

// Get all users (protected route - Admin only)
router.get('/', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Register new user (Admin only)
router.post('/register', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { email, name, password, role = 'CASHIER' } = req.body;
    
    // Validate input
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });
    
    res.status(201).json({
      message: 'User created successfully',
      user
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Enhanced login with session management
router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe = false } = req.body;
    
    console.log('🔐 Login attempt:', { email, hasPassword: !!password });
    
    // Validate input
    if (!email || !password) {
      console.log('❌ Missing credentials');
      return res.status(400).json({ 
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    console.log('👤 User found:', !!user);
    
    if (!user) {
      console.log('❌ User not found for email:', email);
      return res.status(400).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    // Check if user is active
    if (!user.isActive) {
      console.log('❌ User account deactivated');
      return res.status(403).json({ 
        error: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('🔑 Password match:', isMatch);
    
    if (!isMatch) {
      console.log('❌ Password mismatch');
      return res.status(400).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }
    
    // Generate JWT token with extended expiry for remember me
    const expiresIn = rememberMe ? '7d' : '24h';
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        permissions: PERMISSIONS[user.role] || []
      },
      process.env.JWT_SECRET,
      { expiresIn }
    );
    
    // Create session
    const sessionId = sessionManager.createSession(
      user.id, 
      token, 
      rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    );
    
    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    
    res.json({
      message: 'Login successful',
      token,
      sessionId,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: PERMISSIONS[user.role] || []
      }
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ 
      error: 'Failed to login',
      code: 'LOGIN_ERROR'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        name,
        email
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        updatedAt: true
      }
    });
    
    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    
    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId }
    });
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        password: hashedNewPassword
      }
    });
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Enhanced logout with session management
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    
    if (sessionId) {
      sessionManager.removeSession(sessionId);
    }
    
    res.json({
      message: 'Logout successful',
      code: 'LOGOUT_SUCCESS'
    });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ 
      error: 'Failed to logout',
      code: 'LOGOUT_ERROR'
    });
  }
});

// Get active sessions (own sessions or admin can see all)
router.get('/sessions', authenticateToken, async (req, res) => {
  try {
    let sessions;
    
    if (req.user.role === 'ADMIN') {
      // Admin can see all sessions
      sessions = Array.from(sessionManager.activeSessions.entries()).map(([sessionId, session]) => ({
        sessionId,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastActivity: session.lastActivity
      }));
    } else {
      // Users can only see their own sessions
      sessions = sessionManager.getUserSessions(req.user.userId);
    }
    
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch sessions',
      code: 'SESSIONS_FETCH_ERROR'
    });
  }
});

// Terminate specific session (own session or admin can terminate any)
router.delete('/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.activeSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }
    
    // Check permissions
    if (req.user.role !== 'ADMIN' && session.userId !== req.user.userId) {
      return res.status(403).json({ 
        error: 'Cannot terminate another user\'s session',
        code: 'INSUFFICIENT_PERMISSION'
      });
    }
    
    sessionManager.removeSession(sessionId);
    
    res.json({
      message: 'Session terminated successfully',
      code: 'SESSION_TERMINATED'
    });
  } catch (error) {
    console.error('Error terminating session:', error);
    res.status(500).json({ 
      error: 'Failed to terminate session',
      code: 'SESSION_TERMINATE_ERROR'
    });
  }
});

// Validate current session
router.get('/validate-session', authenticateToken, (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    
    if (sessionId && sessionManager.validateSession(sessionId)) {
      res.json({
        valid: true,
        user: {
          id: req.user.userId,
          email: req.user.email,
          role: req.user.role,
          permissions: req.user.permissions
        }
      });
    } else {
      res.status(401).json({
        valid: false,
        error: 'Session expired or invalid',
        code: 'SESSION_INVALID'
      });
    }
  } catch (error) {
    console.error('Error validating session:', error);
    res.status(500).json({ 
      error: 'Failed to validate session',
      code: 'SESSION_VALIDATION_ERROR'
    });
  }
});

// Check user permissions
router.get('/permissions', authenticateToken, (req, res) => {
  res.json({
    role: req.user.role,
    permissions: req.user.permissions || []
  });
});

module.exports = router;
