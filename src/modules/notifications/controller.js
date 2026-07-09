'use strict';

const { listForUser, markRead, markAllRead } = require('./service');
const { sendSuccess } = require('../../utils/response');

/**
 * GET /api/v1/notifications
 * Returns the logged-in user's most recent notifications for the bell icon.
 */
async function getMyNotifications(req, res, next) {
  try {
    const items = await listForUser(req.user._id);
    const formatted = items.map((n) => ({
      id: n._id,
      title: n.title,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt,
    }));
    return sendSuccess(res, formatted, 'Notifications retrieved');
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/notifications/:id/read
 */
async function markNotificationRead(req, res, next) {
  try {
    const notification = await markRead(req.params.id, req.user._id);
    return sendSuccess(res, notification, 'Notification marked as read');
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/v1/notifications/read-all
 */
async function markAllNotificationsRead(req, res, next) {
  try {
    await markAllRead(req.user._id);
    return sendSuccess(res, null, 'All notifications marked as read');
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMyNotifications, markNotificationRead, markAllNotificationsRead };
