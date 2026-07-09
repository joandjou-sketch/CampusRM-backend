'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const InstitutionalRegistry = require('../../models/InstitutionalRegistry');
const { sendSuccess, sendError } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');

/** Role-based JWT expiry */
const TOKEN_EXPIRY = {
  STUDENT: '8h',
  FACULTY: '8h',
  STAFF: '24h',
  LIBRARIAN: '24h',
  LAB_MANAGER: '24h',
  EQUIPMENT_MANAGER: '24h',
  BUS_MANAGER: '24h',
  ADMIN: '24h',
};

/**
 * POST /api/v1/auth/register
 * Requires a valid schoolId from the InstitutionalRegistry.
 * Role, name, email and department are sourced from the registry —
 * the client cannot self-assign a role or supply false identity data.
 */
async function register(req, res, next) {
  try {
    const { schoolId, password, phone } = req.body;

    if (!schoolId || !password) {
      return sendError(res, 'schoolId and password are required', 400);
    }

    const entry = await InstitutionalRegistry.findOne({ schoolId: schoolId.toUpperCase() });
    if (!entry) {
      return sendError(res, 'School ID not found in the institutional registry. Contact your administrator.', 404);
    }

    const existing = await User.findOne({ email: entry.email });
    if (existing) {
      return sendError(res, 'An account for this school ID has already been registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName:   entry.name,
      email:      entry.email,
      passwordHash,
      role:       entry.role,
      department: entry.department,
      phone,
      isActive: false,
    });

    await logAction(null, 'USER_REGISTERED', 'User', user._id, { email: user.email, role: user.role, schoolId }, req.ip);

    return sendSuccess(
      res,
      { userId: user._id, email: user.email, role: user.role, fullName: user.fullName },
      'Account created. An administrator must approve your account before you can sign in.',
      201
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/auth/login
 * Validates credentials, returns a signed JWT.
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendError(res, 'Email and password are required', 400);
    }

    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
      return sendError(res, 'Invalid credentials', 401);
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      await logAction(user._id, 'LOGIN_FAILED', 'User', user._id, { email }, req.ip);
      return sendError(res, 'Invalid credentials', 401);
    }

    if (!user.isActive) {
      if (user.status === 'BLOCKED') {
        await logAction(user._id, 'LOGIN_BLOCKED_ACCOUNT', 'User', user._id, { email }, req.ip);
        return sendError(res, 'Your account has been blocked. Contact an administrator.', 403);
      }
      await logAction(user._id, 'LOGIN_BLOCKED_PENDING', 'User', user._id, { email }, req.ip);
      return sendError(res, 'Your account is awaiting administrator approval.', 403);
    }

    const expiry = TOKEN_EXPIRY[user.role] || '8h';
    const token = jwt.sign(
      { sub: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: expiry }
    );

    await logAction(user._id, 'LOGIN_SUCCESS', 'User', user._id, { role: user.role }, req.ip);

    return sendSuccess(res, {
      token,
      expiresIn: expiry,
      user: { userId: user._id, fullName: user.fullName, email: user.email, role: user.role },
    }, 'Login successful');
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/auth/logout
 * Stateless logout — instructs the client to discard the token.
 */
async function logout(req, res, next) {
  try {
    await logAction(req.user?._id, 'LOGOUT', 'User', req.user?._id, {}, req.ip);
    return sendSuccess(res, null, 'Logged out. Please discard your token.');
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/v1/auth/change-password
 * Authenticated route — verifies current password, saves new hash.
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return sendError(res, 'currentPassword and newPassword are required', 400);
    }
    if (newPassword.length < 8) {
      return sendError(res, 'New password must be at least 8 characters', 400);
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return sendError(res, 'Current password is incorrect', 401);
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    await logAction(user._id, 'PASSWORD_CHANGED', 'User', user._id, {}, req.ip);

    return sendSuccess(res, null, 'Password updated successfully');
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, logout, changePassword };
