'use strict';

const User = require('../../models/User');
const Resource = require('../../models/Resource');
const Booking = require('../../models/Booking');
const Checkout = require('../../models/Checkout');
const LibraryTransaction = require('../../models/LibraryTransaction');

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Lists users for the admin "Manage Users" screen.
 * @param {object} opts
 * @param {string} [opts.status] - 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'ALL' (default 'ALL')
 * @param {string} [opts.role] - filter by role
 * @param {number|string} [opts.page]
 * @param {number|string} [opts.limit]
 */
async function listUsers({ status, role, page = 1, limit = 20 } = {}) {
  const query = {};

  const normalizedStatus = (status || 'ALL').toUpperCase();
  if (['PENDING', 'ACTIVE', 'BLOCKED'].includes(normalizedStatus)) query.status = normalizedStatus;

  if (role) query.role = role;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    User.countDocuments(query),
  ]);

  return {
    users,
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.max(Math.ceil(total / limitNum), 1) },
  };
}

/** Activates a pending account. */
async function approveUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404);
  if (user.status !== 'PENDING') throw httpError('Only pending accounts can be approved', 409);

  user.status = 'ACTIVE';
  user.isActive = true;
  await user.save();
  return user;
}

/** Removes a pending account that should not be granted access. */
async function rejectUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404);
  if (user.status !== 'PENDING') throw httpError('Only pending accounts can be rejected', 409);

  await User.deleteOne({ _id: userId });
  return user;
}

/**
 * Blocks an active account, revoking login access without deleting it.
 * Refuses to let an admin block themselves, or block the only active admin.
 */
async function blockUser(userId, actingUserId) {
  if (String(userId) === String(actingUserId)) throw httpError('You cannot block your own account', 400);

  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404);
  if (user.status !== 'ACTIVE') throw httpError('Only active accounts can be blocked', 409);

  if (user.role === 'ADMIN') {
    const otherActiveAdmins = await User.countDocuments({
      role: 'ADMIN',
      status: 'ACTIVE',
      _id: { $ne: userId },
    });
    if (otherActiveAdmins === 0) throw httpError('Cannot block the only active administrator', 409);
  }

  user.status = 'BLOCKED';
  user.isActive = false;
  await user.save();
  return user;
}

/** Re-activates a previously blocked account. */
async function unblockUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404);
  if (user.status !== 'BLOCKED') throw httpError('Only blocked accounts can be unblocked', 409);

  user.status = 'ACTIVE';
  user.isActive = true;
  await user.save();
  return user;
}

/**
 * Permanently deletes an account. Refuses to delete a user with open
 * bookings or unreturned items — block instead, or resolve those first.
 * Also refuses to let an admin delete themselves, or delete the only active admin.
 */
async function deleteUser(userId, actingUserId) {
  if (String(userId) === String(actingUserId)) throw httpError('You cannot delete your own account', 400);

  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 404);

  if (user.role === 'ADMIN') {
    const otherActiveAdmins = await User.countDocuments({
      role: 'ADMIN',
      status: 'ACTIVE',
      _id: { $ne: userId },
    });
    if (otherActiveAdmins === 0) throw httpError('Cannot delete the only active administrator', 409);
  }

  const [openBookings, openCheckouts, openLoans] = await Promise.all([
    Booking.countDocuments({ createdBy: userId, status: { $in: ['PENDING', 'CONFIRMED'] } }),
    Checkout.countDocuments({ createdBy: userId, status: { $in: ['ACTIVE', 'OVERDUE', 'RETURN_PENDING'] } }),
    LibraryTransaction.countDocuments({ user: userId, status: { $in: ['ACTIVE', 'OVERDUE', 'RETURN_PENDING'] } }),
  ]);

  if (openBookings || openCheckouts || openLoans) {
    throw httpError(
      'Cannot delete: this user has active bookings or unreturned items. Block the account instead, or resolve those first.',
      409
    );
  }

  await User.deleteOne({ _id: userId });
  return user;
}

/** Counts active users grouped by role, for the admin dashboard. */
async function getUsersByRole() {
  const counts = await User.aggregate([
    { $match: { status: 'ACTIVE' } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);

  return counts.map((c) => ({ role: c._id, count: c.count }));
}

/**
 * Counts bookings grouped by status and the type of resource they're for
 * (e.g. LAB/PENDING, BUS/CONFIRMED), for the admin dashboard's bookings chart.
 */
async function getBookingsByStatus() {
  const rows = await Booking.aggregate([
    {
      $lookup: {
        from: Resource.collection.name,
        localField: 'resource',
        foreignField: '_id',
        as: 'resourceDoc',
      },
    },
    { $unwind: '$resourceDoc' },
    {
      $group: {
        _id: { status: '$status', resourceType: '$resourceDoc.type' },
        count: { $sum: 1 },
      },
    },
  ]);

  return rows.map((r) => ({ status: r._id.status, resourceType: r._id.resourceType, count: r.count }));
}

/**
 * Counts resources grouped by type and current status, for the admin
 * dashboard's resource-availability chart.
 */
async function getResourceStatusBreakdown() {
  const rows = await Resource.aggregate([
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
  ]);

  return rows.map((r) => ({ type: r._id.type, status: r._id.status, count: r.count }));
}

/**
 * Daily booking-creation counts for the last `days` days (zero-filled for
 * days with no activity), for the admin dashboard's activity trend chart.
 * @param {number} days
 */
async function getBookingActivityTrend(days = 14) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const rows = await Booking.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
  ]);

  const countsByDate = new Map(rows.map((r) => [r._id, r.count]));
  const trend = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(since);
    day.setDate(since.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    trend.push({ date: key, count: countsByDate.get(key) ?? 0 });
  }
  return trend;
}

module.exports = {
  listUsers, approveUser, rejectUser, blockUser, unblockUser, deleteUser, getUsersByRole,
  getBookingsByStatus, getResourceStatusBreakdown, getBookingActivityTrend,
};
