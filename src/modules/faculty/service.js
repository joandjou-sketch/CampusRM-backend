'use strict';

const Subject = require('../../models/Subject');
const Enrollment = require('../../models/Enrollment');
const ClassLog = require('../../models/ClassLog');
const Assignment = require('../../models/Assignment');
const AssignmentMark = require('../../models/AssignmentMark');
const Booking = require('../../models/Booking');
const Notification = require('../../models/Notification');

/**
 * Dashboard stats for a Faculty/Staff user: today's class sessions, assignments
 * still missing a mark from at least one enrolled student, upcoming lab/equipment
 * bookings, and unread notifications.
 */
async function getFacultyStats(facultyId) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const now = new Date();

  const classesToday = await ClassLog.countDocuments({
    faculty: facultyId,
    date: { $gte: startOfToday, $lt: endOfToday },
  });

  const subjects = await Subject.find({ faculty: facultyId }).select('_id').lean();
  const subjectIds = subjects.map((s) => s._id);

  const dueAssignments = await Assignment.find({
    subject: { $in: subjectIds },
    dueDate: { $lte: now },
  }).select('_id subject').lean();

  let pendingGrading = 0;
  for (const assignment of dueAssignments) {
    const [enrolledCount, gradedCount] = await Promise.all([
      Enrollment.countDocuments({ subject: assignment.subject }),
      AssignmentMark.countDocuments({ assignment: assignment._id }),
    ]);
    pendingGrading += Math.max(0, enrolledCount - gradedCount);
  }

  const upcomingBookings = await Booking.countDocuments({
    createdBy: facultyId,
    startTime: { $gt: now },
    status: { $nin: ['CANCELLED', 'REJECTED'] },
  });

  const unreadNotifications = await Notification.countDocuments({ user: facultyId, read: false });

  return { classesToday, pendingGrading, upcomingBookings, unreadNotifications };
}

module.exports = { getFacultyStats };
