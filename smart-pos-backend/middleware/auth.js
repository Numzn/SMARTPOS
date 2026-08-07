const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const auditService = require('../services/auditService');

/**
 * Enhanced Authentication & Authorization Middleware
 * Provides role-based and permission-based access control for 100% compliance
 */

// Role-based permissions matrix
const PERMISSIONS = {
  ADMIN: [
    'users:read', 'users:write', 'users:delete',
    'products:read', 'products:write', 'products:delete',
    'categories:read', 'categories:write', 'categories:delete',
    'inventory:read', 'inventory:write', 'inventory:delete',
    'sales:read', 'sales:write', 'sales:delete', 'sales:refund',
    'receipts:read',
    'reports:read', 'reports:write',
    'settings:read', 'settings:write',
    'shifts:read', 'shifts:write',
    'customers:read', 'customers:write', 'customers:delete',
    'suppliers:read', 'suppliers:write', 'suppliers:delete',
    'purchasing:read', 'purchasing:write',
    'zra:submit', 'zra:sync', 'zra:read',
    'audit:read'
  ],
  MANAGER: [
    'users:read',
    'products:read', 'products:write',
    'categories:read', 'categories:write',
    'inventory:read', 'inventory:write',
    'sales:read', 'sales:write', 'sales:refund',
    'receipts:read',
    'reports:read',
    'settings:read',
    'shifts:read', 'shifts:write',
    'customers:read', 'customers:write', 'customers:delete',
    'suppliers:read', 'suppliers:write', 'suppliers:delete',
    'purchasing:read', 'purchasing:write',
    'zra:submit', 'zra:sync', 'zra:read',
    'audit:read'
  ],
  CASHIER: [
    'products:read',
    'categories:read',
    'inventory:read',
    'sales:read', 'sales:write',
    'receipts:read',
    'shifts:write',
    'customers:read', 'customers:write',
    // Read-only fiscal device status. A cashier has to be able to tell whether
    // ZRA submission is working — it decides whether they keep trading — and
    // without this the till's status call 403s and the UI reports the fiscal
    // service as offline when it is perfectly healthy. The payload is device
    // identity (TPIN, branch, device serial) that already prints on every
    // receipt they handle, so this grants no visibility they lacked.
    'zra:read',
  ],
  VIEWER: [
    'products:read',
    'categories:read',
    'inventory:read',
    'sales:read',
    'reports:read',
    'shifts:read',
    'customers:read',
    'suppliers:read',
    'purchasing:read',
  ]
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
    
    // Add user info and permissions to request
    req.user = {
      ...decoded,
      permissions: PERMISSIONS[user.role] || []
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
          permissions: PERMISSIONS[user.role] || []
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
  PERMISSIONS
};
