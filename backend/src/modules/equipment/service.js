'use strict';

const Resource = require('../../models/Resource');
const Booking = require('../../models/Booking');
const Checkout = require('../../models/Checkout');
const MaintenanceLog = require('../../models/MaintenanceLog');
const User = require('../../models/User');
const { findConflicts, suggestAlternatives } = require('../shared/conflictDetection');
const { notify, notifyRoles, notifyResourceManagerOrRole } = require('../../utils/notifier');

const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'];
const ACTIVE_CHECKOUT_STATUSES = ['ACTIVE', 'OVERDUE'];
const OPEN_MAINTENANCE_STATUSES = ['REPORTED', 'SCHEDULED', 'IN_PROGRESS'];

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/* ── Inventory & real-time availability (UC-25, IT-01) ───────────────────── */

/**
 * Derives the live status of an equipment Resource: its own status takes
 * precedence for MAINTENANCE/RETIRED, otherwise it reflects any active
 * Checkout or in-progress Booking.
 */
async function computeLiveStatus(resource) {
  if (resource.status === 'MAINTENANCE' || resource.status === 'RETIRED') {
    return resource.status;
  }

  const activeCheckout = await Checkout.exists({
    resource: resource._id,
    status: { $in: ACTIVE_CHECKOUT_STATUSES },
  });
  if (activeCheckout) return 'CHECKED_OUT';

  const now = new Date();
  const activeBooking = await Booking.exists({
    resource: resource._id,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    startTime: { $lte: now },
    endTime: { $gte: now },
  });
  if (activeBooking) return 'BOOKED';

  return 'AVAILABLE';
}

/**
 * Lists all equipment-type Resources with their derived live status.
 */
async function listEquipment() {
  const items = await Resource.find({ type: 'EQUIPMENT' }).lean();

  return Promise.all(
    items.map(async (item) => ({
      ...item,
      liveStatus: await computeLiveStatus(item),
    }))
  );
}

/**
 * Returns a single equipment item plus its live status, current active
 * checkout (if any), and current open maintenance entry (if any).
 */
async function getEquipmentDetail(equipmentId) {
  const item = await Resource.findOne({ _id: equipmentId, type: 'EQUIPMENT' }).lean();
  if (!item) throw httpError('Equipment item not found', 404);

  const [liveStatus, activeCheckout, activeMaintenance] = await Promise.all([
    computeLiveStatus(item),
    Checkout.findOne({ resource: equipmentId, status: { $in: ACTIVE_CHECKOUT_STATUSES } })
      .populate('createdBy', 'fullName email role')
      .lean(),
    MaintenanceLog.findOne({ resource: equipmentId, status: { $in: OPEN_MAINTENANCE_STATUSES } })
      .sort({ reportDate: -1 })
      .lean(),
  ]);

  return { ...item, liveStatus, activeCheckout, activeMaintenance };
}

/* ── Checkout request & approval flow (UC-26, UC-29, IT-02) ──────────────── */

/** Notifies the equipment's manager (or every EQUIPMENT_MANAGER/ADMIN) that a request is pending approval. */
async function notifyResourceManager(booking) {
  const [resource, requester] = await Promise.all([
    Resource.findById(booking.resource).select('name managedBy'),
    User.findById(booking.createdBy).select('fullName'),
  ]);

  await notifyResourceManagerOrRole(resource, ['EQUIPMENT_MANAGER'], {
    title: 'New equipment request',
    message: `${requester?.fullName ?? 'A user'} requested "${resource?.name ?? 'an item'}" — pending your approval.`,
    type: 'EQUIPMENT_BOOKING_PENDING',
    entityType: 'Booking',
    entityId: booking._id,
  });
}

/**
 * Validates an equipment checkout request, runs conflict detection, and
 * creates a PENDING Booking if the time window is free. Restricted users
 * (per IT-04) are blocked until their overdue items are resolved.
 */
async function requestCheckout(equipmentId, userId, { startTime, endTime, purpose }) {
  if (!startTime || !endTime) throw httpError('startTime and endTime are required', 400);
  if (!purpose) throw httpError('purpose is required', 400);

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError('startTime and endTime must be valid dates', 400);
  }
  if (start >= end) throw httpError('startTime must be before endTime', 400);
  if (start < new Date()) throw httpError('Cannot request a time slot in the past', 400);

  const item = await Resource.findOne({ _id: equipmentId, type: 'EQUIPMENT' });
  if (!item) throw httpError('Equipment item not found', 404);
  if (item.status === 'RETIRED') throw httpError('This item is retired and cannot be requested', 400);

  const requester = await User.findById(userId);
  if (requester && requester.equipmentRestricted) {
    throw httpError('Your account is restricted from equipment checkouts due to an overdue item', 403);
  }
  if (requester && requester.equipmentAccess === 'BLOCKED') {
    throw httpError('You are blocked from equipment access. Contact the equipment manager for details.', 403);
  }

  const conflictResult = await findConflicts(equipmentId, start, end);
  if (conflictResult.hasConflict) {
    const alternatives = await suggestAlternatives(equipmentId, start, end);

    const err = new Error(
      'The requested time slot conflicts with an existing booking or scheduled maintenance for this item'
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
    resource: equipmentId,
    createdBy: userId,
    startTime: start,
    endTime: end,
    purpose,
    status: 'PENDING',
  });

  return booking;
}

async function getEquipmentBookingOrThrow(bookingId) {
  const booking = await Booking.findById(bookingId).populate('resource');
  if (!booking || !booking.resource || booking.resource.type !== 'EQUIPMENT') {
    throw httpError('Equipment booking not found', 404);
  }
  return booking;
}

/**
 * Resource Manager/Admin: approves a PENDING equipment booking request. This
 * performs the same handover bookkeeping as an immediate checkout, since
 * approval happens at the moment the item is actually handed over (mirrors
 * the library's approve-and-borrow flow).
 */
async function approveBooking(bookingId, approverId, { dueTime, conditionAtCheckout, notes } = {}) {
  const booking = await getEquipmentBookingOrThrow(bookingId);
  if (booking.status !== 'PENDING') {
    throw httpError(`Cannot approve a booking with status ${booking.status}`, 400);
  }

  const resource = booking.resource;
  if (resource.status === 'RETIRED') {
    throw httpError('This item is retired and cannot be checked out', 400);
  }

  let due = booking.endTime;
  if (dueTime) {
    due = new Date(dueTime);
    if (Number.isNaN(due.getTime())) throw httpError('dueTime must be a valid date', 400);
  }

  const checkout = await Checkout.create({
    booking: booking._id,
    resource: resource._id,
    createdBy: booking.createdBy,
    checkedOutBy: approverId,
    dueTime: due,
    condition: { atCheckout: conditionAtCheckout },
    notes,
  });

  await Resource.findByIdAndUpdate(resource._id, { status: 'CHECKED_OUT' });

  booking.status = 'COMPLETED';
  booking.approvedBy = approverId;
  await booking.save();

  await notify(booking.createdBy, {
    title: 'Equipment request approved',
    message: `Your request for "${resource.name}" has been approved and checked out. Please return it by ${due.toDateString()}.`,
    type: 'EQUIPMENT_BOOKING_APPROVED',
    entityType: 'Checkout',
    entityId: checkout._id,
  });

  return { booking, checkout };
}

/**
 * Resource Manager/Admin: rejects a PENDING equipment booking request with a required reason.
 */
async function rejectBooking(bookingId, approverId, reason) {
  const booking = await getEquipmentBookingOrThrow(bookingId);
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
 * Returns the logged-in user's own equipment booking requests and their statuses (UC-27).
 */
async function getMyBookings(userId) {
  const bookings = await Booking.find({ createdBy: userId })
    .populate('resource', 'name type location')
    .sort({ startTime: -1 })
    .lean();

  return bookings.filter((b) => b.resource && b.resource.type === 'EQUIPMENT');
}

/* ── Check-in (UC-04, IT-03) ──────────────────────────────────────────────── */

async function getCheckoutOrThrow(checkoutId) {
  const checkout = await Checkout.findById(checkoutId);
  if (!checkout) throw httpError('Checkout not found', 404);
  return checkout;
}

/**
 * Resource Manager records the return of a checked-out item: sets returnTime,
 * condition at return, and status RETURNED. Restores the Resource to AVAILABLE
 * and lifts the user's IT-04 restriction once they have no other overdue items.
 */
async function checkinEquipment(checkoutId, { conditionAtReturn, notes } = {}) {
  const checkout = await getCheckoutOrThrow(checkoutId);
  if (checkout.status === 'RETURNED') {
    throw httpError('This item has already been checked in', 400);
  }

  const wasOverdue = checkout.status === 'OVERDUE' || checkout.isOverdue();

  await checkout.returnResource(conditionAtReturn);
  if (notes) {
    checkout.notes = notes;
    await checkout.save();
  }

  const resource = await Resource.findById(checkout.resource);
  if (resource && resource.status === 'CHECKED_OUT') {
    resource.status = 'AVAILABLE';
    await resource.save();
  }

  if (wasOverdue) {
    const stillOverdue = await Checkout.exists({ createdBy: checkout.createdBy, status: 'OVERDUE' });
    if (!stillOverdue) {
      await User.findByIdAndUpdate(checkout.createdBy, { equipmentRestricted: false });
    }
  }

  return checkout;
}

/**
 * Resource Manager/Admin view of all currently overdue checkouts.
 */
async function getOverdueCheckouts() {
  return Checkout.find({
    status: { $in: ACTIVE_CHECKOUT_STATUSES },
    dueTime: { $lt: new Date() },
  })
    .populate('resource', 'name location type')
    .populate('createdBy', 'fullName email role')
    .sort({ dueTime: 1 })
    .lean();
}

/**
 * The logged-in user's currently checked-out equipment (their "My Equipment"
 * view), including anything they've marked as returned pending confirmation.
 */
async function getUserCheckouts(userId) {
  const checkouts = await Checkout.find({
    createdBy: userId,
    status: { $in: [...ACTIVE_CHECKOUT_STATUSES, 'RETURN_PENDING'] },
  })
    .populate('resource', 'name location')
    .sort({ dueTime: 1 })
    .lean();

  return checkouts.map((c) => ({
    checkoutId: c._id,
    resource: c.resource,
    checkoutTime: c.checkoutTime,
    dueTime: c.dueTime,
    status: c.status,
    isOverdue: c.status !== 'RETURNED' && new Date() > c.dueTime,
  }));
}

/**
 * Borrower marks a checked-out item as returned. Doesn't free up the item
 * yet — the manager must confirm (via the existing checkinEquipment flow)
 * before it becomes AVAILABLE again, in case it wasn't actually brought back.
 */
async function requestReturn(checkoutId, userId) {
  const checkout = await Checkout.findOne({ _id: checkoutId, createdBy: userId });
  if (!checkout) throw httpError('Checkout not found', 404);
  if (!ACTIVE_CHECKOUT_STATUSES.includes(checkout.status)) {
    throw httpError(`Cannot request a return for a checkout with status ${checkout.status}`, 400);
  }

  checkout.status = 'RETURN_PENDING';
  checkout.returnRequestedAt = new Date();
  await checkout.save();

  const [resource, borrower] = await Promise.all([
    Resource.findById(checkout.resource).select('name managedBy'),
    User.findById(userId).select('fullName'),
  ]);

  await notifyResourceManagerOrRole(resource, ['EQUIPMENT_MANAGER'], {
    title: 'Equipment marked as returned',
    message: `${borrower?.fullName ?? 'A user'} marked "${resource?.name ?? 'an item'}" as returned — pending your confirmation.`,
    type: 'EQUIPMENT_RETURN_PENDING',
    entityType: 'Checkout',
    entityId: checkout._id,
  });

  return checkout;
}

/**
 * Resource Manager/Admin view of all return requests awaiting confirmation.
 */
async function getPendingReturns() {
  const checkouts = await Checkout.find({ status: 'RETURN_PENDING' })
    .populate('resource', 'name location')
    .populate('createdBy', 'fullName email')
    .sort({ returnRequestedAt: 1 })
    .lean();

  return checkouts.map((c) => ({
    checkoutId: c._id,
    resource: c.resource ? { _id: c.resource._id, name: c.resource.name, location: c.resource.location } : null,
    createdBy: c.createdBy ? { _id: c.createdBy._id, fullName: c.createdBy.fullName, email: c.createdBy.email } : null,
    dueTime: c.dueTime,
    returnRequestedAt: c.returnRequestedAt,
  }));
}

/**
 * Resource Manager/Admin: rejects a return request (the item wasn't
 * actually returned), putting the checkout back into ACTIVE/OVERDUE.
 */
async function denyReturnRequest(checkoutId, managerId, reason) {
  if (!reason) throw httpError('reason is required', 400);

  const checkout = await Checkout.findById(checkoutId).populate('resource', 'name');
  if (!checkout) throw httpError('Checkout not found', 404);
  if (checkout.status !== 'RETURN_PENDING') {
    throw httpError(`Cannot deny a checkout with status ${checkout.status}`, 400);
  }

  checkout.status = checkout.dueTime < new Date() ? 'OVERDUE' : 'ACTIVE';
  await checkout.save();

  await notify(checkout.createdBy, {
    title: 'Return request denied',
    message: `Your return of "${checkout.resource?.name ?? 'an item'}" was not confirmed: ${reason}`,
    type: 'EQUIPMENT_RETURN_DENIED',
    entityType: 'Checkout',
    entityId: checkout._id,
  });

  return checkout;
}

/* ── Automated reminders (IT-03, IT-04) ──────────────────────────────────── */

/** Notifies a borrower that their active checkout is due back tomorrow. */
async function notifyUpcomingDue(checkout) {
  await notify(checkout.createdBy._id ?? checkout.createdBy, {
    title: 'Equipment due tomorrow',
    message: `"${checkout.resource?.name ?? 'Your checked-out item'}" is due back tomorrow.`,
    type: 'EQUIPMENT_DUE_SOON',
    entityType: 'Checkout',
    entityId: checkout._id,
  });
}

/**
 * Scheduled job body (run daily via node-cron):
 *  - Notifies users whose ACTIVE checkout is due tomorrow (IT-03).
 *  - Flags ACTIVE checkouts past their dueTime as OVERDUE.
 *  - Restricts (IT-04) any user with an OVERDUE checkout from future requests.
 */
async function processEquipmentReminders() {
  const now = new Date();

  const tomorrowStart = new Date(now);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const dueTomorrow = await Checkout.find({
    status: 'ACTIVE',
    dueTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
  }).populate('resource', 'name');
  await Promise.all(dueTomorrow.map(notifyUpcomingDue));

  const overdue = await Checkout.find({
    status: 'ACTIVE',
    dueTime: { $lt: now },
  }).populate('resource', 'name');

  const restrictedUsers = new Set();
  for (const checkout of overdue) {
    checkout.status = 'OVERDUE';
    await checkout.save();
    restrictedUsers.add(checkout.createdBy.toString());
    await notify(checkout.createdBy, {
      title: 'Equipment overdue',
      message: `"${checkout.resource?.name ?? 'Your checked-out item'}" is overdue. Please return it as soon as possible — you may be blocked or refused access to the equipment if it is not returned on time.`,
      type: 'EQUIPMENT_OVERDUE',
      entityType: 'Checkout',
      entityId: checkout._id,
    });
  }

  for (const userId of restrictedUsers) {
    await User.findByIdAndUpdate(userId, { equipmentRestricted: true });
    await notify(userId, {
      title: 'Equipment requests restricted',
      message: 'You have been restricted from new equipment requests due to an overdue item. Return it to lift the restriction.',
      type: 'EQUIPMENT_RESTRICTED',
    });
  }

  return {
    remindersSent: dueTomorrow.length,
    newlyOverdue: overdue.length,
    restrictedUsers: [...restrictedUsers],
  };
}

/* ── Maintenance logging (UC-30, LAB-03 pattern reused) ───────────────────── */

/**
 * Resource Manager logs an issue: creates a MaintenanceLog entry and puts the
 * item into MAINTENANCE status (unless it is RETIRED).
 */
async function logMaintenance(equipmentId, reportedBy, { description, priority, scheduledDate, assignedTo } = {}) {
  if (!description) throw httpError('description is required', 400);

  const item = await Resource.findOne({ _id: equipmentId, type: 'EQUIPMENT' });
  if (!item) throw httpError('Equipment item not found', 404);

  const log = await MaintenanceLog.create({
    resource: equipmentId,
    description,
    reportedBy,
    priority,
    scheduledDate,
    assignedTo,
    status: scheduledDate ? 'SCHEDULED' : 'REPORTED',
  });

  if (item.status !== 'RETIRED') {
    item.status = 'MAINTENANCE';
    await item.save();
  }

  return log;
}

/**
 * Marks a maintenance entry RESOLVED and, if no other open maintenance
 * entries remain for the item, restores it to AVAILABLE.
 */
async function completeMaintenance(maintenanceId, resolutionNotes) {
  const log = await MaintenanceLog.findById(maintenanceId);
  if (!log) throw httpError('Maintenance log not found', 404);
  if (log.status === 'RESOLVED') throw httpError('This maintenance entry is already resolved', 400);

  await log.resolve(resolutionNotes);

  const stillOpen = await MaintenanceLog.exists({
    resource: log.resource,
    status: { $in: OPEN_MAINTENANCE_STATUSES },
  });

  if (!stillOpen) {
    const item = await Resource.findById(log.resource);
    if (item && item.status === 'MAINTENANCE') {
      item.status = 'AVAILABLE';
      await item.save();
    }
  }

  return log;
}

/**
 * Returns the maintenance history for an equipment item.
 */
async function getMaintenanceHistory(equipmentId) {
  const item = await Resource.findOne({ _id: equipmentId, type: 'EQUIPMENT' }).lean();
  if (!item) throw httpError('Equipment item not found', 404);

  return MaintenanceLog.find({ resource: equipmentId })
    .populate('reportedBy', 'fullName email')
    .populate('assignedTo', 'fullName email')
    .sort({ reportDate: -1 })
    .lean();
}

/* ── Usage reporting (UC-32) ──────────────────────────────────────────────── */

/**
 * Per-item checkout frequency, average loan duration, and overdue rate
 * for checkouts started within [from, to].
 */
async function getUsageReport(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw httpError('from and to must be valid dates with from before to', 400);
  }

  const items = await Resource.find({ type: 'EQUIPMENT' }).lean();
  const now = new Date();

  const equipment = await Promise.all(
    items.map(async (item) => {
      const checkouts = await Checkout.find({
        resource: item._id,
        checkoutTime: { $gte: start, $lte: end },
      }).lean();

      const totalCheckouts = checkouts.length;
      const returned = checkouts.filter((c) => c.returnTime);
      const totalDurationHours = returned.reduce(
        (sum, c) => sum + (c.returnTime.getTime() - c.checkoutTime.getTime()) / (1000 * 60 * 60),
        0
      );
      const avgDurationHours = returned.length ? totalDurationHours / returned.length : 0;
      const overdueCount = checkouts.filter(
        (c) => c.status === 'OVERDUE' || (c.status === 'ACTIVE' && c.dueTime < now)
      ).length;
      const overdueRate = totalCheckouts ? (overdueCount / totalCheckouts) * 100 : 0;

      return {
        equipmentId: item._id,
        name: item.name,
        location: item.location,
        totalCheckouts,
        avgDurationHours: round2(avgDurationHours),
        overdueCount,
        overdueRate: round2(overdueRate),
      };
    })
  );

  return { from: start, to: end, equipment };
}

/* ── Equipment-specific user access management ────────────────────────────── */

/** Roles that actually check out equipment — "users with equipment access" (mirrors the nav config). */
const EQUIPMENT_BORROWER_ROLES = ['STUDENT', 'FACULTY', 'STAFF', 'LAB_MANAGER', 'BUS_MANAGER'];

/**
 * Resource Manager/Admin: lists borrower-role users with their equipment
 * access status and current checkout counts, for the equipment user
 * management page. Supports optional search (name/email) and status filter.
 */
async function getEquipmentUsers({ search, status } = {}) {
  const query = { role: { $in: EQUIPMENT_BORROWER_ROLES } };

  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const normalizedStatus = (status || '').toUpperCase();
  if (['ACTIVE', 'BLOCKED'].includes(normalizedStatus)) {
    query.equipmentAccess = normalizedStatus;
  }

  const users = await User.find(query).sort({ fullName: 1 }).lean();

  const counts = await Promise.all(
    users.map((u) =>
      Promise.all([
        Checkout.countDocuments({ createdBy: u._id, status: { $in: ACTIVE_CHECKOUT_STATUSES } }),
        Checkout.countDocuments({ createdBy: u._id, status: 'OVERDUE' }),
      ])
    )
  );

  return users.map((u, i) => ({
    ...u,
    activeCheckouts: counts[i][0],
    overdueCheckouts: counts[i][1],
  }));
}

/**
 * Resource Manager/Admin: blocks a user's equipment access specifically
 * (not their whole account), with a required reason. Notifies the user and
 * broadcasts to every ADMIN.
 */
async function blockEquipmentAccess(userId, reason) {
  if (!reason) throw httpError('reason is required', 400);

  const user = await User.findOne({ _id: userId, role: { $in: EQUIPMENT_BORROWER_ROLES } });
  if (!user) throw httpError('User not found', 404);
  if (user.equipmentAccess === 'BLOCKED') throw httpError('This user is already blocked from equipment access', 409);

  user.equipmentAccess = 'BLOCKED';
  user.equipmentAccessBlockReason = reason;
  await user.save();

  await notify(user._id, {
    title: 'Equipment access blocked',
    message: `You have been blocked from equipment access. Reason: ${reason}`,
    type: 'EQUIPMENT_ACCESS_BLOCKED',
    entityType: 'User',
    entityId: user._id,
  });

  await notifyRoles(['ADMIN'], {
    title: 'User blocked from equipment access',
    message: `${user.fullName} (${user.email}) has been blocked from equipment access by an equipment manager. Reason: ${reason}`,
    type: 'EQUIPMENT_ACCESS_BLOCKED',
    entityType: 'User',
    entityId: user._id,
  });

  return user;
}

/**
 * Resource Manager/Admin: restores a user's equipment access.
 */
async function unblockEquipmentAccess(userId) {
  const user = await User.findOne({ _id: userId, role: { $in: EQUIPMENT_BORROWER_ROLES } });
  if (!user) throw httpError('User not found', 404);
  if (user.equipmentAccess !== 'BLOCKED') throw httpError('This user is not blocked from equipment access', 409);

  user.equipmentAccess = 'ACTIVE';
  user.equipmentAccessBlockReason = undefined;
  await user.save();

  await notify(user._id, {
    title: 'Equipment access restored',
    message: 'Your equipment access has been restored.',
    type: 'EQUIPMENT_ACCESS_UNBLOCKED',
    entityType: 'User',
    entityId: user._id,
  });

  return user;
}

module.exports = {
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
  processEquipmentReminders,
  logMaintenance,
  completeMaintenance,
  getMaintenanceHistory,
  getUsageReport,
  getEquipmentUsers,
  blockEquipmentAccess,
  unblockEquipmentAccess,
};
