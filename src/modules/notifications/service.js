'use strict';

const Notification = require('../../models/Notification');

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** Returns a user's most recent notifications, newest first. */
async function listForUser(userId, { limit = 50 } = {}) {
  return Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

/** Marks one of the user's own notifications as read. */
async function markRead(notificationId, userId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { read: true },
    { new: true }
  );
  if (!notification) throw httpError('Notification not found', 404);
  return notification;
}

/** Marks every unread notification belonging to the user as read. */
async function markAllRead(userId) {
  await Notification.updateMany({ user: userId, read: false }, { read: true });
}

module.exports = { listForUser, markRead, markAllRead };
