'use strict';

const {
  listLabs,
  getLabSchedule,
  createBookingRequest,
  notifyResourceManager,
  getMyBookings,
  approveBooking,
  rejectBooking,
  cancelBooking,
  getUtilizationReport,
} = require('./service');
const { sendSuccess, sendError } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');
const { sendCsv } = require('../../utils/csv');
const { streamTablePdf } = require('../../utils/pdf');

/* ── Schedule viewing (GEN-06 / UC-34) ───────────────────────────────────── */

async function getLabs(req, res, next) {
  try {
    const labs = await listLabs();
    return sendSuccess(res, labs, 'Labs retrieved');
  } catch (err) {
    return next(err);
  }
}

async function getSchedule(req, res, next) {
  try {
    const { from, to } = req.query;
    const result = await getLabSchedule(req.params.id, from, to);
    return sendSuccess(res, result, 'Lab schedule retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Booking requests & conflict detection (UC-35, LAB-02) ──────────────── */

async function bookLab(req, res, next) {
  try {
    const booking = await createBookingRequest(req.params.id, req.user._id, req.body);

    await logAction(
      req.user._id,
      'LAB_BOOKING_REQUESTED',
      'Booking',
      booking._id,
      { resource: req.params.id, startTime: booking.startTime, endTime: booking.endTime, purpose: booking.purpose },
      req.ip
    );

    await notifyResourceManager(booking);

    return sendSuccess(res, booking, 'Booking request submitted and pending approval', 201);
  } catch (err) {
    if (err.statusCode === 409 && err.suggestedAlternatives) {
      return sendError(res, err.message, 409, null, {
        data: {
          conflicts: err.conflicts,
          suggestedAlternatives: err.suggestedAlternatives,
        },
      });
    }
    return next(err);
  }
}

/* ── Status & approval workflow (UC-36, UC-37) ───────────────────────────── */

async function getMyLabBookings(req, res, next) {
  try {
    const bookings = await getMyBookings(req.user._id);
    return sendSuccess(res, bookings, 'Your lab booking requests');
  } catch (err) {
    return next(err);
  }
}

async function approveLabBooking(req, res, next) {
  try {
    const booking = await approveBooking(req.params.id, req.user._id);
    await logAction(req.user._id, 'LAB_BOOKING_APPROVED', 'Booking', booking._id, {}, req.ip);
    return sendSuccess(res, booking, 'Booking approved');
  } catch (err) {
    return next(err);
  }
}

async function rejectLabBooking(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return sendError(res, 'reason is required', 400);

    const booking = await rejectBooking(req.params.id, req.user._id, reason);
    await logAction(req.user._id, 'LAB_BOOKING_REJECTED', 'Booking', booking._id, { reason }, req.ip);
    return sendSuccess(res, booking, 'Booking rejected');
  } catch (err) {
    return next(err);
  }
}

/* ── Cancellation (UC-38) ─────────────────────────────────────────────────── */

async function cancelLabBooking(req, res, next) {
  try {
    const booking = await cancelBooking(req.params.id, req.user._id, req.user.role);
    await logAction(req.user._id, 'LAB_BOOKING_CANCELLED', 'Booking', booking._id, {}, req.ip);
    return sendSuccess(res, booking, 'Booking cancelled');
  } catch (err) {
    return next(err);
  }
}

/* ── Utilization reporting (UC-40) ───────────────────────────────────────── */

async function getUtilizationStats(req, res, next) {
  try {
    const { from, to } = req.query;
    const format = (req.query.format || 'json').toLowerCase();

    if (!from || !to) {
      return sendError(res, 'from and to query parameters are required', 400);
    }
    if (!['json', 'csv', 'pdf'].includes(format)) {
      return sendError(res, 'format must be one of: json, csv, pdf', 400);
    }

    const report = await getUtilizationReport(from, to);

    const columns = [
      { label: 'Lab ID', value: (l) => l.labId },
      { label: 'Lab Name', value: (l) => l.name },
      { label: 'Location', value: (l) => l.location || '' },
      { label: 'Capacity', value: (l) => (l.capacity ?? '') },
      { label: 'Booked Hours', value: (l) => l.bookedHours },
      { label: 'Available Hours', value: (l) => l.availableHours },
      { label: 'Utilization %', value: (l) => l.utilizationPercent },
    ];

    if (format === 'csv') {
      return sendCsv(res, `lab-utilization-${from}-to-${to}.csv`, report.labs, columns);
    }

    if (format === 'pdf') {
      return streamTablePdf(res, {
        title: 'Lab Utilization Report',
        subtitle: `Period: ${from} to ${to}`,
        filename: `lab-utilization-${from}-to-${to}.pdf`,
        columns,
        rows: report.labs,
      });
    }

    return sendSuccess(res, report, 'Lab utilization report generated');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getLabs,
  getSchedule,
  bookLab,
  getMyLabBookings,
  approveLabBooking,
  rejectLabBooking,
  cancelLabBooking,
  getUtilizationStats,
};
