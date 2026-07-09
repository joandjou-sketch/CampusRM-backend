'use strict';

const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Creates an in-app notification for one user. Never throws — notification
 * delivery is a best-effort side effect and must never break the calling
 * request/job (a failed notify() should not roll back a booking, checkout, etc).
 */
async function notify(userId, { title, message, type, entityType, entityId } = {}) {
  if (!userId || !title || !message) return null;
  try {
    return await Notification.create({ user: userId, title, message, type, entityType, entityId });
  } catch (err) {
    console.error('[notifier] failed to create notification:', err.message);
    return null;
  }
}

/** Notifies every active user holding one of the given roles (e.g. broadcasting to managers). */
async function notifyRoles(roles, payload) {
  try {
    const users = await User.find({ role: { $in: roles }, status: 'ACTIVE' }).select('_id').lean();
    await Promise.all(users.map((u) => notify(u._id, payload)));
  } catch (err) {
    console.error('[notifier] failed to notify roles:', err.message);
  }
}

/**
 * Notifies a resource's assigned manager (`managedBy`) if one is set,
 * otherwise broadcasts to every active user holding one of the given
 * manager roles plus ADMIN. Used where a Resource may or may not have an
 * owner assigned yet.
 */
async function notifyResourceManagerOrRole(resource, managerRoles, payload) {
  if (resource && resource.managedBy) {
    return notify(resource.managedBy, payload);
  }
  return notifyRoles([...managerRoles, 'ADMIN'], payload);
}

module.exports = { notify, notifyRoles, notifyResourceManagerOrRole };
