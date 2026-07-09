'use strict';

const {
  listEquipment,
  getEquipmentDetail,
  notifyResourceManager,
  requestCheckout,
  approveBooking,
  rejectBooking,
  getMyBookings,
  checkinEquipment,
  getOverdueCheckouts,
  getUserCheckouts,
  requestReturn,
  getPendingReturns,
  denyReturnRequest,
  logMaintenance,
  completeMaintenance,
  getMaintenanceHistory,
  getUsageReport,
  getEquipmentUsers,
  blockEquipmentAccess,
  unblockEquipmentAccess,
} = require('./service');
const { sendSuccess, sendError } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');
const { sendCsv } = require('../../utils/csv');
const { streamTablePdf } = require('../../utils/pdf');

/* ── Inventory & real-time availability (UC-25, IT-01) ───────────────────── */

async function getEquipmentList(req, res, next) {
  try {
    const items = await listEquipment();
    return sendSuccess(res, items, 'Equipment retrieved');
  } catch (err) {
    return next(err);
  }
}

async function getEquipmentItem(req, res, next) {
  try {
    const item = await getEquipmentDetail(req.params.id);
    return sendSuccess(res, item, 'Equipment item retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Checkout request & approval flow (UC-26, UC-29, IT-02) ──────────────── */

async function requestEquipmentCheckout(req, res, next) {
  try {
    const booking = await requestCheckout(req.params.id, req.user._id, req.body);

    await logAction(
      req.user._id,
      'EQUIPMENT_BOOKING_REQUESTED',
      'Booking',
      booking._id,
      { resource: req.params.id, startTime: booking.startTime, endTime: booking.endTime, purpose: booking.purpose },
      req.ip
    );

    await notifyResourceManager(booking);

    return sendSuccess(res, booking, 'Checkout request submitted and pending approval', 201);
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

async function approveEquipmentBooking(req, res, next) {
  try {
    const { dueTime, conditionAtCheckout, notes } = req.body;
    const { booking, checkout } = await approveBooking(req.params.id, req.user._id, {
      dueTime,
      conditionAtCheckout,
      notes,
    });
    await logAction(
      req.user._id,
      'EQUIPMENT_BOOKING_APPROVED',
      'Booking',
      booking._id,
      { checkout: checkout._id, dueTime: checkout.dueTime },
      req.ip
    );
    return sendSuccess(res, { booking, checkout }, 'Booking approved and equipment checked out');
  } catch (err) {
    return next(err);
  }
}

async function rejectEquipmentBooking(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return sendError(res, 'reason is required', 400);

    const booking = await rejectBooking(req.params.id, req.user._id, reason);
    await logAction(req.user._id, 'EQUIPMENT_BOOKING_REJECTED', 'Booking', booking._id, { reason }, req.ip);
    return sendSuccess(res, booking, 'Booking rejected');
  } catch (err) {
    return next(err);
  }
}

async function getMyEquipmentBookings(req, res, next) {
  try {
    const bookings = await getMyBookings(req.user._id);
    return sendSuccess(res, bookings, 'Your equipment requests');
  } catch (err) {
    return next(err);
  }
}

/* ── Check-in (UC-04, IT-03) ──────────────────────────────────────────────── */

async function checkinEquipmentItem(req, res, next) {
  try {
    const { conditionAtReturn, notes } = req.body;
    const checkout = await checkinEquipment(req.params.checkoutId, { conditionAtReturn, notes });

    await logAction(
      req.user._id,
      'EQUIPMENT_CHECKED_IN',
      'Checkout',
      checkout._id,
      { resource: checkout.resource, conditionAtReturn },
      req.ip
    );

    return sendSuccess(res, checkout, 'Equipment checked in');
  } catch (err) {
    return next(err);
  }
}

async function getOverdueEquipmentCheckouts(req, res, next) {
  try {
    const checkouts = await getOverdueCheckouts();
    return sendSuccess(res, checkouts, 'Overdue equipment checkouts');
  } catch (err) {
    return next(err);
  }
}

async function getMyEquipmentCheckouts(req, res, next) {
  try {
    const checkouts = await getUserCheckouts(req.user._id);
    return sendSuccess(res, checkouts, 'Your checked-out equipment');
  } catch (err) {
    return next(err);
  }
}

/* ── Borrower-initiated return, pending manager confirmation ─────────────── */

async function requestEquipmentReturn(req, res, next) {
  try {
    const checkout = await requestReturn(req.params.checkoutId, req.user._id);
    await logAction(req.user._id, 'EQUIPMENT_RETURN_REQUESTED', 'Checkout', checkout._id, {}, req.ip);
    return sendSuccess(res, checkout, 'Return marked — pending manager confirmation');
  } catch (err) {
    return next(err);
  }
}

async function getPendingEquipmentReturns(req, res, next) {
  try {
    const returns = await getPendingReturns();
    return sendSuccess(res, returns, 'Pending return requests');
  } catch (err) {
    return next(err);
  }
}

async function denyEquipmentReturn(req, res, next) {
  try {
    const { reason } = req.body;
    const checkout = await denyReturnRequest(req.params.checkoutId, req.user._id, reason);
    await logAction(req.user._id, 'EQUIPMENT_RETURN_DENIED', 'Checkout', checkout._id, { reason }, req.ip);
    return sendSuccess(res, checkout, 'Return request denied');
  } catch (err) {
    return next(err);
  }
}

/* ── Equipment-specific user access management ────────────────────────────── */

async function getEquipmentUsersController(req, res, next) {
  try {
    const { search, status } = req.query;
    const users = await getEquipmentUsers({ search, status });
    return sendSuccess(res, users, 'Equipment users retrieved');
  } catch (err) {
    return next(err);
  }
}

async function blockEquipmentAccessController(req, res, next) {
  try {
    const { reason } = req.body;
    const user = await blockEquipmentAccess(req.params.id, reason);
    await logAction(req.user._id, 'EQUIPMENT_ACCESS_BLOCKED', 'User', user._id, { email: user.email, reason }, req.ip);
    return sendSuccess(res, user, 'User blocked from equipment access');
  } catch (err) {
    return next(err);
  }
}

async function unblockEquipmentAccessController(req, res, next) {
  try {
    const user = await unblockEquipmentAccess(req.params.id);
    await logAction(req.user._id, 'EQUIPMENT_ACCESS_UNBLOCKED', 'User', user._id, { email: user.email }, req.ip);
    return sendSuccess(res, user, "User's equipment access restored");
  } catch (err) {
    return next(err);
  }
}

/* ── Maintenance logging (UC-30) ──────────────────────────────────────────── */

async function logEquipmentMaintenance(req, res, next) {
  try {
    const log = await logMaintenance(req.params.id, req.user._id, req.body);
    await logAction(
      req.user._id,
      'EQUIPMENT_MAINTENANCE_LOGGED',
      'MaintenanceLog',
      log._id,
      { resource: req.params.id, description: log.description, priority: log.priority },
      req.ip
    );
    return sendSuccess(res, log, 'Maintenance issue logged', 201);
  } catch (err) {
    return next(err);
  }
}

async function completeEquipmentMaintenance(req, res, next) {
  try {
    const { resolutionNotes } = req.body;
    const log = await completeMaintenance(req.params.id, resolutionNotes);
    await logAction(req.user._id, 'EQUIPMENT_MAINTENANCE_RESOLVED', 'MaintenanceLog', log._id, { resolutionNotes }, req.ip);
    return sendSuccess(res, log, 'Maintenance marked resolved');
  } catch (err) {
    return next(err);
  }
}

async function getEquipmentMaintenanceHistory(req, res, next) {
  try {
    const history = await getMaintenanceHistory(req.params.id);
    return sendSuccess(res, history, 'Maintenance history retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Usage reporting (UC-32) ──────────────────────────────────────────────── */

async function getUsageStats(req, res, next) {
  try {
    const { from, to } = req.query;
    const format = (req.query.format || 'json').toLowerCase();

    if (!from || !to) {
      return sendError(res, 'from and to query parameters are required', 400);
    }
    if (!['json', 'csv', 'pdf'].includes(format)) {
      return sendError(res, 'format must be one of: json, csv, pdf', 400);
    }

    const report = await getUsageReport(from, to);

    const columns = [
      { label: 'Equipment ID', value: (e) => e.equipmentId },
      { label: 'Name', value: (e) => e.name },
      { label: 'Location', value: (e) => e.location || '' },
      { label: 'Total Checkouts', value: (e) => e.totalCheckouts },
      { label: 'Avg Duration (hrs)', value: (e) => e.avgDurationHours },
      { label: 'Overdue Count', value: (e) => e.overdueCount },
      { label: 'Overdue Rate %', value: (e) => e.overdueRate },
    ];

    if (format === 'csv') {
      return sendCsv(res, `equipment-usage-${from}-to-${to}.csv`, report.equipment, columns);
    }

    if (format === 'pdf') {
      return streamTablePdf(res, {
        title: 'Equipment Usage Report',
        subtitle: `Period: ${from} to ${to}`,
        filename: `equipment-usage-${from}-to-${to}.pdf`,
        columns,
        rows: report.equipment,
      });
    }

    return sendSuccess(res, report, 'Equipment usage report generated');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getEquipmentList,
  getEquipmentItem,
  requestEquipmentCheckout,
  approveEquipmentBooking,
  rejectEquipmentBooking,
  getMyEquipmentBookings,
  checkinEquipmentItem,
  getOverdueEquipmentCheckouts,
  getMyEquipmentCheckouts,
  requestEquipmentReturn,
  getPendingEquipmentReturns,
  denyEquipmentReturn,
  logEquipmentMaintenance,
  completeEquipmentMaintenance,
  getEquipmentMaintenanceHistory,
  getUsageStats,
  getEquipmentUsersController,
  blockEquipmentAccessController,
  unblockEquipmentAccessController,
};
