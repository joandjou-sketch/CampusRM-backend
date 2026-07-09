'use strict';

const AuditLog = require('../../models/AuditLog');

/**
 * Appends an immutable audit entry.
 * Call this from controllers/services after any significant state change.
 *
 * @param {object} opts
 * @param {ObjectId|null} opts.user - The acting user's _id (null for system actions)
 * @param {string} opts.action - e.g. 'BOOK_CREATED', 'CHECKOUT_RETURNED'
 * @param {string} opts.entityType - e.g. 'Booking', 'Checkout', 'Resource'
 * @param {ObjectId} [opts.entityId] - The affected document's _id
 * @param {object} [opts.details] - Extra context (before/after snapshots, etc.)
 * @param {string} [opts.ipAddress]
 */
async function log({ user, action, entityType, entityId, details, ipAddress }) {
  try {
    await AuditLog.create({ user, action, entityType, entityId, details, ipAddress });
  } catch (err) {
    /* Audit failures must never break the main request — only log to console */
    console.error('[AuditLogger] Failed to write audit entry:', err.message);
  }
}

module.exports = { log };
