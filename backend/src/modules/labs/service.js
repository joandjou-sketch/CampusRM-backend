'use strict';

const Resource = require('../../models/Resource');
const Booking = require('../../models/Booking');
const MaintenanceLog = require('../../models/MaintenanceLog');
const User = require('../../models/User');
const { findConflicts, suggestAlternatives, maintenanceWindow } = require('../shared/conflictDetection');
const { notifyResourceManagerOrRole } = require('../../utils/notifier');

const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'];

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Lists all lab-type Resources with capacity, location, and current status.
 */
async function listLabs() {
  return Resource.find({ type: 'LAB' })
    .select('name type location capacity status description metadata managedBy')
    .lean();
}

/**
 * Returns a lab plus its CONFIRMED/PENDING bookings within an optional date range.
 */
async function getLabSchedule(labId, from, to) {
  const lab = await Resource.findOne({ _id: labId, type: 'LAB' }).lean();
  if (!lab) throw httpError('Lab not found', 404);

  const query = {
    resource: labId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
  };

  if (from || to) {
    query.startTime = {};
    if (from) query.startTime.$gte = new Date(from);
    if (to) query.startTime.$lte = new Date(to);
  }

  const bookings = await Booking.find(query)
    .populate('createdBy', 'fullName email role')
    .sort({ startTime: 1 })
    .lean();

  return { lab, bookings };
}

/**
 * Validates a booking request, runs conflict detection against existing
 * Bookings and MaintenanceLog entries, and creates a PENDING Booking if clear.
 * On conflict, throws a 409 error carrying `conflicts` and `suggestedAlternatives`.
 */
async function createBookingRequest(labId, userId, { startTime, endTime, purpose }) {
  if (!startTime || !endTime) throw httpError('startTime and endTime are required', 400);
  if (!purpose) throw httpError('purpose is required', 400);

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError('startTime and endTime must be valid dates', 400);
  }
  if (start >= end) throw httpError('startTime must be before endTime', 400);
  if (start < new Date()) throw httpError('Cannot book a time slot in the past', 400);

  const lab = await Resource.findOne({ _id: labId, type: 'LAB' });
  if (!lab) throw httpError('Lab not found', 404);
  if (lab.status === 'RETIRED') throw httpError('This lab is retired and cannot be booked', 400);

  const conflictResult = await findConflicts(labId, start, end);
  if (conflictResult.hasConflict) {
    const alternatives = await suggestAlternatives(labId, start, end);

    const err = new Error(
      'The requested time slot conflicts with an existing booking or scheduled maintenance for this lab'
    );
    err.statusCode = 409;
    err.conflicts = {
      bookings: conflictResult.bookingConflicts,
      maintenance: conflictResult.maintenanceConflicts,
    };
    err.suggestedAlternatives = alternatives;
    throw err;
  }

  const booking = await Booking.create({
    resource: labId,
    createdBy: userId,
    startTime: start,
    endTime: end,
    purpose,
    status: 'PENDING',
  });

  return booking;
}

/** Notifies the lab's manager (or every LAB_MANAGER/ADMIN) that a booking is pending approval. */
async function notifyResourceManager(booking) {
  const [resource, requester] = await Promise.all([
    Resource.findById(booking.resource).select('name managedBy'),
    User.findById(booking.createdBy).select('fullName'),
  ]);

  await notifyResourceManagerOrRole(resource, ['LAB_MANAGER'], {
    title: 'New lab booking request',
    message: `${requester?.fullName ?? 'A user'} requested "${resource?.name ?? 'a lab'}" — pending your approval.`,
    type: 'LAB_BOOKING_PENDING',
    entityType: 'Booking',
    entityId: booking._id,
  });
}

/**
 * Returns the logged-in user's own lab booking requests and their statuses.
 */
async function getMyBookings(userId) {
  const bookings = await Booking.find({ createdBy: userId })
    .populate('resource', 'name type location capacity')
    .sort({ startTime: -1 })
    .lean();

  return bookings.filter((b) => b.resource && b.resource.type === 'LAB');
}

async function getLabBookingOrThrow(bookingId) {
  const booking = await Booking.findById(bookingId).populate('resource');
  if (!booking || !booking.resource || booking.resource.type !== 'LAB') {
    throw httpError('Lab booking not found', 404);
  }
  return booking;
}

/**
 * Resource Manager/Admin: confirms a PENDING booking.
 */
async function approveBooking(bookingId, approverId) {
  const booking = await getLabBookingOrThrow(bookingId);
  if (booking.status !== 'PENDING') {
    throw httpError(`Cannot approve a booking with status ${booking.status}`, 400);
  }
  booking.status = 'CONFIRMED';
  booking.approvedBy = approverId;
  await booking.save();
  return booking;
}

/**
 * Resource Manager/Admin: rejects a PENDING booking with a required reason.
 */
async function rejectBooking(bookingId, approverId, reason) {
  const booking = await getLabBookingOrThrow(bookingId);
  if (booking.status !== 'PENDING') {
    throw httpError(`Cannot reject a booking with status ${booking.status}`, 400);
  }
  booking.status = 'REJECTED';
  booking.approvedBy = approverId;
  booking.notes = reason;
  await booking.save();
  return booking;
}

/**
 * Booking owner or an Admin/Lab Manager can cancel a PENDING or CONFIRMED booking.
 */
async function cancelBooking(bookingId, userId, userRole) {
  const booking = await getLabBookingOrThrow(bookingId);

  const isOwner = booking.createdBy.toString() === userId.toString();
  const isAdmin = ['ADMIN', 'LAB_MANAGER'].includes(userRole);
  if (!isOwner && !isAdmin) {
    throw httpError('You are not authorized to cancel this booking', 403);
  }

  if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
    throw httpError(`Cannot cancel a booking with status ${booking.status}`, 400);
  }

  booking.status = 'CANCELLED';
  await booking.save();
  return booking;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Aggregates booked hours vs. available hours per lab over [from, to].
 * Available hours are the total hours in the range minus any time blocked
 * by maintenance; booked hours come from CONFIRMED/COMPLETED bookings.
 */
async function getUtilizationReport(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw httpError('from and to must be valid dates with from before to', 400);
  }

  const totalRangeHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  const labs = await Resource.find({ type: 'LAB' }).lean();

  const report = await Promise.all(
    labs.map(async (lab) => {
      const [bookings, maintenanceLogs] = await Promise.all([
        Booking.find({
          resource: lab._id,
          status: { $in: ['CONFIRMED', 'COMPLETED'] },
          startTime: { $lt: end },
          endTime: { $gt: start },
        }).select('startTime endTime').lean(),
        MaintenanceLog.find({
          resource: lab._id,
          status: { $in: ['SCHEDULED', 'IN_PROGRESS', 'RESOLVED'] },
        }).lean(),
      ]);

      const bookedHours = bookings.reduce((sum, b) => {
        const overlapStart = b.startTime > start ? b.startTime : start;
        const overlapEnd = b.endTime < end ? b.endTime : end;
        return sum + Math.max(0, (overlapEnd - overlapStart) / (1000 * 60 * 60));
      }, 0);

      const maintenanceHours = maintenanceLogs.reduce((sum, log) => {
        const { start: mStart, end: mEnd } = maintenanceWindow(log);
        const overlapStart = mStart > start ? mStart : start;
        const overlapEnd = mEnd < end ? mEnd : end;
        return sum + Math.max(0, (overlapEnd - overlapStart) / (1000 * 60 * 60));
      }, 0);

      const availableHours = Math.max(0, totalRangeHours - maintenanceHours);
      const utilizationPercent = availableHours > 0 ? (bookedHours / availableHours) * 100 : 0;

      return {
        labId: lab._id,
        name: lab.name,
        location: lab.location,
        capacity: lab.capacity,
        bookedHours: round2(bookedHours),
        availableHours: round2(availableHours),
        utilizationPercent: round2(utilizationPercent),
      };
    })
  );

  return { from: start, to: end, labs: report };
}

module.exports = {
  listLabs,
  getLabSchedule,
  createBookingRequest,
  notifyResourceManager,
  getMyBookings,
  approveBooking,
  rejectBooking,
  cancelBooking,
  getUtilizationReport,
};
