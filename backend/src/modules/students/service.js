'use strict';

const Booking = require('../../models/Booking');
const LibraryTransaction = require('../../models/LibraryTransaction');
const Notification = require('../../models/Notification');

/**
 * Dashboard stats for a Student user: active lab/equipment bookings, currently
 * borrowed library books, overdue items, and unread notifications.
 */
async function getStudentStats(studentId) {
  const now = new Date();

  const activeBookings = await Booking.countDocuments({
    createdBy: studentId,
    endTime: { $gte: now },
    status: { $nin: ['CANCELLED', 'REJECTED', 'COMPLETED'] },
  });

  const borrowedBooks = await LibraryTransaction.countDocuments({ user: studentId, status: 'ACTIVE' });

  const overdueItems = await LibraryTransaction.countDocuments({
    user: studentId,
    status: { $in: ['ACTIVE', 'OVERDUE'] },
    dueDate: { $lt: now },
  });

  const unreadNotifications = await Notification.countDocuments({ user: studentId, read: false });

  return { activeBookings, borrowedBooks, overdueItems, unreadNotifications };
}

module.exports = { getStudentStats };
