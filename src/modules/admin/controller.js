'use strict';

const {
  listUsers, approveUser, rejectUser, blockUser, unblockUser, deleteUser, getUsersByRole,
  getBookingsByStatus, getResourceStatusBreakdown, getBookingActivityTrend,
} = require('./service');
const InstitutionalRegistry = require('../../models/InstitutionalRegistry');
const User = require('../../models/User');
const Resource = require('../../models/Resource');
const Booking = require('../../models/Booking');
const Checkout = require('../../models/Checkout');
const AuditLog = require('../../models/AuditLog');
const { sendSuccess } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');

/**
 * GET /api/v1/admin/users
 * Query: status (PENDING|ACTIVE|BLOCKED|ALL), role, page, limit
 */
async function getUsers(req, res, next) {
  try {
    const { status, role, page, limit } = req.query;
    const result = await listUsers({ status, role, page, limit });
    return sendSuccess(res, result.users, 'Users retrieved', 200, result.pagination);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/admin/users/:id/approve
 * Activates a pending account so it can log in.
 */
async function approveUserAccount(req, res, next) {
  try {
    const user = await approveUser(req.params.id);
    await logAction(req.user._id, 'USER_APPROVED', 'User', user._id, { email: user.email, role: user.role }, req.ip);
    return sendSuccess(res, user, 'User account approved');
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/admin/users/:id/reject
 * Deletes a pending account that should not be granted access.
 */
async function rejectUserAccount(req, res, next) {
  try {
    const user = await rejectUser(req.params.id);
    await logAction(req.user._id, 'USER_REJECTED', 'User', user._id, { email: user.email, role: user.role }, req.ip);
    return sendSuccess(res, null, 'User account rejected and removed');
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/admin/users/:id/block
 * Revokes login access for an active account without deleting it.
 */
async function blockUserAccount(req, res, next) {
  try {
    const user = await blockUser(req.params.id, req.user._id);
    await logAction(req.user._id, 'USER_BLOCKED', 'User', user._id, { email: user.email, role: user.role }, req.ip);
    return sendSuccess(res, user, 'User account blocked');
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/admin/users/:id/unblock
 * Restores login access for a previously blocked account.
 */
async function unblockUserAccount(req, res, next) {
  try {
    const user = await unblockUser(req.params.id);
    await logAction(req.user._id, 'USER_UNBLOCKED', 'User', user._id, { email: user.email, role: user.role }, req.ip);
    return sendSuccess(res, user, 'User account unblocked');
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/v1/admin/users/:id
 * Permanently removes an account. Refuses if it has open bookings/loans.
 */
async function deleteUserAccount(req, res, next) {
  try {
    const user = await deleteUser(req.params.id, req.user._id);
    await logAction(req.user._id, 'USER_DELETED', 'User', user._id, { email: user.email, role: user.role }, req.ip);
    return sendSuccess(res, null, 'User account deleted');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/users/by-role
 */
async function getUsersByRoleStats(req, res, next) {
  try {
    const counts = await getUsersByRole();
    return sendSuccess(res, counts, 'User counts by role');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/registry
 * Returns all institutional registry entries. Supports ?search= for quick lookup.
 */
async function getRegistry(req, res, next) {
  try {
    const { search } = req.query;
    const filter = search
      ? {
          $or: [
            { schoolId:   { $regex: search, $options: 'i' } },
            { name:       { $regex: search, $options: 'i' } },
            { email:      { $regex: search, $options: 'i' } },
            { role:       { $regex: search, $options: 'i' } },
            { department: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const entries = await InstitutionalRegistry.find(filter).sort({ role: 1, name: 1 });
    return sendSuccess(res, entries, 'Registry retrieved');
  } catch (err) {
    return next(err);
  }
}

/** Actions treated as suspicious / worth flagging on the dashboard. */
const FLAGGED_ACTIONS = [
  'LOGIN_FAILED',
  'LOGIN_BLOCKED_PENDING',
  'LOGIN_BLOCKED_ACCOUNT',
  'USER_REJECTED',
  'USER_BLOCKED',
  'USER_DELETED',
  'EQUIPMENT_RESTRICTED',
  'LIBRARY_ACCESS_BLOCKED',
  'EQUIPMENT_ACCESS_BLOCKED',
  'PASSWORD_CHANGED',
];

/**
 * GET /api/v1/admin/stats
 * Aggregate numbers for the four stat cards on the admin dashboard.
 */
async function getStats(req, res, next) {
  try {
    const [totalUsers, overdueItems, labIds, equipIds] = await Promise.all([
      User.countDocuments({}),
      Checkout.countDocuments({ status: 'OVERDUE' }),
      Resource.distinct('_id', { type: 'LAB' }),
      Resource.distinct('_id', { type: 'EQUIPMENT' }),
    ]);

    const [activeBookings, pendingUsers, pendingLabBookings, pendingEquipmentRequests] = await Promise.all([
      Booking.countDocuments({ status: { $in: ['CONFIRMED', 'PENDING'] } }),
      User.countDocuments({ status: 'PENDING' }),
      Booking.countDocuments({ status: 'PENDING', resource: { $in: labIds } }),
      Booking.countDocuments({ status: 'PENDING', resource: { $in: equipIds } }),
    ]);

    return sendSuccess(res, {
      totalUsers,
      activeBookings,
      pendingApprovals: pendingUsers + pendingLabBookings + pendingEquipmentRequests,
      overdueItems,
    }, 'Stats retrieved');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/activity
 * Last 20 audit log entries, newest first, with the acting user's name/email.
 */
async function getActivity(req, res, next) {
  try {
    const logs = await AuditLog
      .find({})
      .sort({ timestamp: -1 })
      .limit(20)
      .populate('user', 'fullName email');

    const items = logs.map((log) => ({
      id: log._id,
      action: log.action,
      entityType: log.entityType,
      performedBy: log.user ? (log.user.fullName || log.user.email) : null,
      timestamp: log.timestamp,
    }));

    return sendSuccess(res, items, 'Activity retrieved');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/audit-flags
 * Recent suspicious actions flagged for admin attention.
 */
async function getAuditFlags(req, res, next) {
  try {
    const logs = await AuditLog
      .find({ action: { $in: FLAGGED_ACTIONS } })
      .sort({ timestamp: -1 })
      .limit(15)
      .populate('user', 'fullName email');

    const flags = logs.map((log) => {
      const who = log.user?.email || log.details?.email || 'Anonymous';
      const ip = log.ipAddress ? `IP: ${log.ipAddress}` : '';
      return {
        id: log._id,
        action: log.action,
        details: [who, ip].filter(Boolean).join('  ·  '),
        timestamp: log.timestamp,
      };
    });

    return sendSuccess(res, flags, 'Audit flags retrieved');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/audit-log
 * Paginated, filterable audit log for the Audit Log admin page.
 * Query params: page, limit, action, search (email / name), dateFrom, dateTo
 */
async function getAuditLog(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.timestamp = {};
      if (req.query.dateFrom) filter.timestamp.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo)   filter.timestamp.$lte = new Date(req.query.dateTo);
    }

    // If searching by email/name, first find matching user IDs
    if (req.query.search) {
      const User2 = require('../../models/User');
      const matchingUsers = await User2.find({
        $or: [
          { fullName: { $regex: req.query.search, $options: 'i' } },
          { email:    { $regex: req.query.search, $options: 'i' } },
        ],
      }).distinct('_id');
      filter.user = { $in: matchingUsers };
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'fullName email role'),
    ]);

    const entries = logs.map((log) => ({
      id:          log._id,
      action:      log.action,
      entityType:  log.entityType,
      performedBy: log.user ? log.user.fullName : null,
      email:       log.user ? log.user.email    : (log.details?.email ?? null),
      role:        log.user ? log.user.role     : null,
      ipAddress:   log.ipAddress ?? null,
      details:     log.details   ?? null,
      timestamp:   log.timestamp,
    }));

    return sendSuccess(res, entries, 'Audit log retrieved', 200, {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/badge-counts
 * Returns pending-action counts for the sidebar badges.
 * ADMIN receives all three; LAB_MANAGER / EQUIPMENT_MANAGER receive only theirs.
 */
async function getBadgeCounts(req, res, next) {
  try {
    const { role } = req.user;
    const counts = {};

    if (role === 'ADMIN') {
      counts.pendingUsers = await User.countDocuments({ status: 'PENDING' });
    }

    if (role === 'ADMIN' || role === 'LAB_MANAGER') {
      const labIds = await Resource.distinct('_id', { type: 'LAB' });
      counts.pendingLabBookings = await Booking.countDocuments({ status: 'PENDING', resource: { $in: labIds } });
    }

    if (role === 'ADMIN' || role === 'EQUIPMENT_MANAGER') {
      const equipIds = await Resource.distinct('_id', { type: 'EQUIPMENT' });
      counts.pendingEquipmentRequests = await Booking.countDocuments({ status: 'PENDING', resource: { $in: equipIds } });
    }

    if (role === 'ADMIN' || role === 'LIBRARIAN') {
      const bookIds = await Resource.distinct('_id', { type: 'OTHER' });
      counts.pendingLibraryRequests = await Booking.countDocuments({ status: 'PENDING', resource: { $in: bookIds } });
    }

    return sendSuccess(res, counts, 'Badge counts retrieved');
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/v1/admin/dashboard-charts
 * Query: trendDays (default 14) — window for the activity trend chart.
 * Bundles the three chart datasets used by the admin dashboard in one call.
 */
async function getDashboardCharts(req, res, next) {
  try {
    const trendDays = Math.min(60, Math.max(7, parseInt(req.query.trendDays, 10) || 14));

    const [bookingsByStatus, resourceStatus, activityTrend] = await Promise.all([
      getBookingsByStatus(),
      getResourceStatusBreakdown(),
      getBookingActivityTrend(trendDays),
    ]);

    return sendSuccess(res, { bookingsByStatus, resourceStatus, activityTrend }, 'Dashboard charts retrieved');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getUsers, approveUserAccount, rejectUserAccount, blockUserAccount, unblockUserAccount, deleteUserAccount,
  getUsersByRoleStats,
  getRegistry, getBadgeCounts,
  getStats, getActivity, getAuditFlags,
  getAuditLog, getDashboardCharts,
};
