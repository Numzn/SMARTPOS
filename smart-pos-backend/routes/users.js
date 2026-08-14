const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { authenticateToken, requireRole, requirePermission, sessionManager, PERMISSIONS } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const auditService = require('../services/auditService');

const MIN_PASSWORD_LENGTH = 8;
const VALID_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'CASHIER', 'VIEWER'];
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 6;

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 chars, URL-safe
}

// Fire-and-forget audit logging — must never block or fail the request path.
const safeAuditAuth = (userId, success, details) => {
  Promise.resolve()
    .then(() => auditService.logUserAuth(userId, success, details))
    .catch((err) => console.warn('[users] audit log skipped:', err.message));
};

// Get all users (protected route - Admin only)
router.get('/', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        // isActive and lastLoginAt were missing, which made the list unable to
        // show who is deactivated even though PUT /:id can set it — an admin
        // could disable an account and see no evidence of it afterwards.
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }]
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
    
    res.json({
      ...user,
      permissions: PERMISSIONS[user.role] || [],
    });
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

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role: ${role}` });
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
    
    auditService.safeLog(auditService.eventTypes.USER_CREATE, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: user.id,
      action: 'CREATE',
      newValues: { email: user.email, name: user.name, role: user.role },
      description: `User created: ${user.email} (${user.role})`,
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
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, rememberMe = false } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(400).json({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      safeAuditAuth(user.id, false, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        errorMessage: 'Invalid password',
      });
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

    safeAuditAuth(user.id, true, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId,
      userRole: user.role,
      loginMethod: 'password',
      rememberMe,
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
    
    auditService.safeLog(auditService.eventTypes.USER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: user.id,
      action: 'UPDATE_PROFILE',
      newValues: { name: user.name, email: user.email },
      description: `Profile updated: ${user.email}`,
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

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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
    
    auditService.safeLog(auditService.eventTypes.USER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: req.user.userId,
      action: 'CHANGE_PASSWORD',
      description: 'Password changed',
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

    auditService.safeLog(auditService.eventTypes.USER_LOGOUT, {
      ...auditService.contextFromReq(req),
      description: 'User logged out',
    });

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

// Get a specific user (Admin only) — placed after all fixed-path routes above
// so this wildcard segment can never shadow /profile, /sessions, etc.
router.get('/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Admin: update another user's role, active status, or name — the
// disable/activate and permission-management (role-based) lifecycle.
router.put('/:id', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, isActive, name } = req.body;

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role: ${role}` });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (id === req.user.userId && isActive === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const data = {};
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;
    if (name !== undefined) data.name = name;

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true, updatedAt: true },
    });

    if (isActive === false) {
      // authenticateToken already blocks a deactivated user on their next
      // request via the isActive DB check — this just keeps the in-memory
      // sessions list from showing stale "active" entries for them.
      for (const s of sessionManager.getUserSessions(id)) {
        sessionManager.removeSession(s.sessionId);
      }
    }

    auditService.safeLog(auditService.eventTypes.USER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: user.id,
      action: 'ADMIN_UPDATE',
      oldValues: { role: existing.role, isActive: existing.isActive, name: existing.name },
      newValues: { role: user.role, isActive: user.isActive, name: user.name },
      description: `User ${user.email} updated by admin (role=${user.role}, isActive=${user.isActive})`,
      riskLevel: isActive === false ? 'MEDIUM' : 'LOW',
    });

    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin: reset another user's password — generates a one-time temporary
// password when the admin doesn't supply one, and invalidates their
// existing sessions so the reset actually forces re-authentication.
router.post('/:id/reset-password', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const suppliedPassword = req.body.newPassword;
    const newPassword = suppliedPassword || generateTempPassword();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id }, data: { password: hashed } });

    for (const s of sessionManager.getUserSessions(id)) {
      sessionManager.removeSession(s.sessionId);
    }

    auditService.safeLog(auditService.eventTypes.USER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: id,
      action: 'ADMIN_RESET_PASSWORD',
      description: `Password reset for ${existing.email} by admin`,
      riskLevel: 'MEDIUM',
    });

    res.json({
      message: 'Password reset successfully',
      // Only handed back when the admin didn't supply their own value —
      // this is the one and only time it's readable; give it to the user now.
      temporaryPassword: suppliedPassword ? undefined : newPassword,
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /api/users/:id/pin — set/reset a supervisor step-up PIN (POS Control
 * Phase 1). Mirrors /:id/reset-password: admin-only, invalidates nothing
 * else, generates a temp PIN if none supplied. The PIN itself is never
 * readable again after this response — same "only handed back once"
 * contract as reset-password's temporaryPassword.
 */
router.post('/:id/pin', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const suppliedPin = req.body.pin;
    const newPin = suppliedPin || String(crypto.randomInt(0, 10 ** MAX_PIN_LENGTH)).padStart(MAX_PIN_LENGTH, '0');

    if (!/^\d+$/.test(newPin) || newPin.length < MIN_PIN_LENGTH || newPin.length > MAX_PIN_LENGTH) {
      return res.status(400).json({ error: `PIN must be ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} digits` });
    }

    const pinHash = await bcrypt.hash(newPin, 10);
    await prisma.user.update({ where: { id }, data: { pinHash } });

    auditService.safeLog(auditService.eventTypes.USER_UPDATE, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: id,
      action: 'ADMIN_SET_PIN',
      description: `Supervisor PIN set for ${existing.email} by admin`,
      riskLevel: 'MEDIUM',
    });

    res.json({
      message: 'PIN set successfully',
      temporaryPin: suppliedPin ? undefined : newPin,
    });
  } catch (error) {
    console.error('Error setting PIN:', error);
    res.status(500).json({ error: 'Failed to set PIN' });
  }
});

/**
 * POST /api/users/:id/zra-sync — register this staff account as a ZRA
 * branch user (VSDC POST /branches/saveBrancheUser). Requires the user to
 * already have a branch assigned — bhfId is a required field on that
 * endpoint, so a user with no branch cannot be pushed.
 */
router.post('/:id/zra-sync', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { branch: { select: { bhfId: true } } },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.branch?.bhfId) {
      return res.status(400).json({
        error: 'User has no assigned branch — cannot register as a ZRA branch user (bhfId is required by the spec)',
      });
    }

    const vsdcGateway = require('../lib/vsdc-gateway');
    const actor = { id: req.user?.userId, name: req.user?.name, email: req.user?.email };

    try {
      await vsdcGateway.saveBranchUser(user, actor);
    } catch (zraError) {
      return res.status(422).json({ error: zraError.message });
    }

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, name: true, zraSyncedAt: true, zraSyncError: true },
    });

    auditService.safeLog(auditService.eventTypes.USER_ZRA_SYNC, {
      ...auditService.contextFromReq(req),
      entityType: 'USER',
      entityId: user.id,
      action: 'ZRA_SYNC',
      description: `User synced to ZRA as branch user: ${user.email}`,
    });

    res.json({ success: true, user: updated, message: 'User registered with ZRA' });
  } catch (error) {
    console.error('Error syncing user to ZRA:', error.message);
    res.status(500).json({ error: 'Failed to sync user to ZRA' });
  }
});

module.exports = router;
