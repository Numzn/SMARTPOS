const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const auditService = require('../services/auditService');
const { DEFAULT_PERMISSIONS, getEffectivePermissions } = require('../lib/permissions');

/**
 * Enhanced Authentication & Authorization Middleware
 * Provides role-based and permission-based access control for 100% compliance
 *
 * The role -> permission matrix itself now lives in the `RolePermission`
 * table (lib/permissions.js), not here — this file only enforces whatever
 * `getEffectivePermissions()` returns. `PERMISSIONS` is kept as an alias for
 * `DEFAULT_PERMISSIONS` for backward-compat callers; it is seed/fallback
 * data, not what's actually enforced at request time.
 */
const PERMISSIONS = DEFAULT_PERMISSIONS;

// Ordered role hierarchy for step-up approval checks (lib/approval.js) — an
// approver just needs rank >= the required tier's rank, so adding or
// removing a tier later (e.g. a future 5th level) is one map entry, not a
// redesign of every "who can approve this" check.
const ROLE_RANK = {
  VIEWER: 0,
  CASHIER: 1,
  SUPERVISOR: 2,
  MANAGER: 3,
  ADMIN: 4,
};

// Session manager for tracking active sessions
const sessionManager = {
  activeSessions: new Map(),
  
  generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },
  
  createSession(userId, token, expiresIn = 24 * 60 * 60 * 1000) {
    const sessionId = this.generateSessionId();
    const expiresAt = new Date(Date.now() + expiresIn);
    
    this.activeSessions.set(sessionId, {
      userId,
      token,
      createdAt: new Date(),
      expiresAt,
      lastActivity: new Date()
    });
    
    return sessionId;
  },
  
  validateSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;
    
    if (new Date() > session.expiresAt) {
      this.activeSessions.delete(sessionId);
      return false;
    }
    
    session.lastActivity = new Date();
    return true;
  },
  
  removeSession(sessionId) {
    return this.activeSessions.delete(sessionId);
  },
  
  getUserSessions(userId) {
    const userSessions = [];
    for (const [sessionId, session] of this.activeSessions) {
      if (session.userId === userId) {
        userSessions.push({ sessionId, ...session });
      }
    }
    return userSessions;
  },
  
  cleanupExpiredSessions() {
    const now = new Date();
    for (const [sessionId, session] of this.activeSessions) {
      if (now > session.expiresAt) {
        this.activeSessions.delete(sessionId);
      }
    }
  }
};

// Cleanup expired sessions every hour
setInterval(() => {
  sessionManager.cleanupExpiredSessions();
}, 60 * 60 * 1000);

/**
 * Enhanced JWT authentication middleware with session validation
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Access token required',
        code: 'TOKEN_MISSING'
      });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Validate user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true, isActive: true }
    });
    
    if (!user || !user.isActive) {
      auditService.safeLog(auditService.eventTypes.UNAUTHORIZED_ACCESS, {
        userId: decoded.userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: 'Token valid but user account inactive or not found',
        action: `${req.method} ${req.originalUrl}`,
        success: false,
      });
      return res.status(403).json({
        error: 'User account is inactive or not found',
        code: 'USER_INACTIVE'
      });
    }
    
    // Add user info and permissions to request. Always resolved fresh from
    // the RolePermission table (not the JWT's embedded snapshot) so a
    // permission change via PUT /api/settings/roles/:role takes effect on
    // this user's very next request — no re-login, no redeploy.
    req.user = {
      ...decoded,
      role: user.role,
      permissions: await getEffectivePermissions(user.role),
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      auditService.safeLog(auditService.eventTypes.UNAUTHORIZED_ACCESS, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: 'Invalid JWT presented',
        action: `${req.method} ${req.originalUrl}`,
        success: false,
      });
      return res.status(403).json({
        error: 'Invalid token',
        code: 'TOKEN_INVALID'
      });
    }
    
    console.error('Token validation error:', error);
    return res.status(500).json({ 
      error: 'Token validation failed',
      code: 'TOKEN_VALIDATION_ERROR'
    });
  }
};

/**
 * Fire-and-forget PERMISSION_DENIED audit entry for a blocked request.
 */
const logPermissionDenied = (req, required) => {
  auditService.safeLog(auditService.eventTypes.PERMISSION_DENIED, {
    userId: req.user?.userId || req.user?.id || null,
    userRole: req.user?.role || null,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    action: `${req.method} ${req.originalUrl}`,
    description: `Access denied. Required: ${required}`,
    success: false,
  });
};

/**
 * Role-based authorization middleware
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      logPermissionDenied(req, `role in [${allowedRoles.join(', ')}]`);
      return res.status(403).json({
        error: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        code: 'INSUFFICIENT_ROLE',
        userRole: req.user.role,
        requiredRoles: allowedRoles
      });
    }
    
    next();
  };
};

/**
 * Permission-based authorization middleware
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    if (!req.user.permissions.includes(permission)) {
      logPermissionDenied(req, permission);
      return res.status(403).json({
        error: `Access denied. Required permission: ${permission}`,
        code: 'INSUFFICIENT_PERMISSION',
        userPermissions: req.user.permissions,
        requiredPermission: permission
      });
    }
    
    next();
  };
};

/**
 * Multiple permissions check (user must have ALL permissions)
 */
const requireAllPermissions = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    const missingPermissions = permissions.filter(
      permission => !req.user.permissions.includes(permission)
    );
    
    if (missingPermissions.length > 0) {
      logPermissionDenied(req, `all of [${permissions.join(', ')}]`);
      return res.status(403).json({
        error: `Access denied. Missing permissions: ${missingPermissions.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        userPermissions: req.user.permissions,
        requiredPermissions: permissions,
        missingPermissions
      });
    }
    
    next();
  };
};

/**
 * Any permission check (user must have at least ONE permission)
 */
const requireAnyPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    
    const hasPermission = permissions.some(
      permission => req.user.permissions.includes(permission)
    );
    
    if (!hasPermission) {
      logPermissionDenied(req, `one of [${permissions.join(', ')}]`);
      return res.status(403).json({
        error: `Access denied. Required one of: ${permissions.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        userPermissions: req.user.permissions,
        requiredPermissions: permissions
      });
    }
    
    next();
  };
};

/**
 * Optional authentication - adds user info if token provided but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, role: true, isActive: true }
      });
      
      if (user && user.isActive) {
        req.user = {
          ...decoded,
          role: user.role,
          permissions: await getEffectivePermissions(user.role),
        };
      }
    }
    
    next();
  } catch (error) {
    // Ignore auth errors for optional auth
    next();
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requirePermission,
  requireAllPermissions,
  requireAnyPermission,
  optionalAuth,
  sessionManager,
  PERMISSIONS,
  ROLE_RANK
};
