'use strict';

const AuditLog = require('../models/AuditLog');

/**
 * Appends an immutable audit entry.
 * Failures are swallowed so they never break the calling request.
 *
 * @param {ObjectId|null} user - Acting user's _id (null for system/anonymous actions)
 * @param {string} action - e.g. 'LOGIN_SUCCESS', 'BOOKING_CONFIRMED'
 * @param {string} entityType - e.g. 'User', 'Booking', 'Resource'
 * @param {ObjectId} [entityId] - The affected document's _id
 * @param {object} [details] - Extra context (snapshot, diff, reason)
 * @param {string} [ipAddress]
 */
async function logAction(user, action, entityType, entityId, details = {}, ipAddress) {
  try {
    await AuditLog.create({ user, action, entityType, entityId, details, ipAddress });
  } catch (err) {
    console.error('[AuditLogger] Failed to write entry:', err.message);
  }
}

module.exports = { logAction };
