'use strict';

const Booking = require('../../models/Booking');
const MaintenanceLog = require('../../models/MaintenanceLog');

/**
 * Builds the standard $or overlap clauses for a [startTime, endTime) window.
 */
function overlapClauses(startTime, endTime) {
  return [
    { startTime: { $lt: endTime, $gte: startTime } },
    { endTime: { $gt: startTime, $lte: endTime } },
    { startTime: { $lte: startTime }, endTime: { $gte: endTime } },
  ];
}

/**
 * Standalone conflict-detection engine.
 * Used by lab and library booking services before confirming a reservation.
 *
 * @param {ObjectId} resourceId
 * @param {Date} startTime
 * @param {Date} endTime
 * @param {ObjectId} [excludeBookingId] - Existing booking id to ignore (for updates)
 * @returns {Promise<boolean>} true if a conflict exists
 */
async function hasConflict(resourceId, startTime, endTime, excludeBookingId = null) {
  const query = {
    resource: resourceId,
    status: { $in: ['CONFIRMED', 'PENDING'] },
    $or: overlapClauses(startTime, endTime),
  };

  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }

  const conflict = await Booking.findOne(query).lean();
  return !!conflict;
}

/**
 * MaintenanceLog stores a single scheduledDate rather than a start/end range.
 * Scheduled (or resolved) maintenance is treated as blocking the entire
 * scheduled day; IN_PROGRESS work without a resolvedDate is treated as
 * blocking indefinitely from that date onward.
 */
function maintenanceWindow(log) {
  const start = log.scheduledDate || log.reportDate;
  if (log.status === 'IN_PROGRESS' && !log.resolvedDate) {
    return { start, end: new Date(8640000000000000) };
  }
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);
  return { start, end: log.resolvedDate || dayEnd };
}

/**
 * Finds every Booking (PENDING/CONFIRMED) and MaintenanceLog (SCHEDULED/IN_PROGRESS)
 * entry that overlaps the requested [startTime, endTime) window for a resource.
 *
 * @param {ObjectId} resourceId
 * @param {Date} startTime
 * @param {Date} endTime
 * @param {ObjectId} [excludeBookingId] - Existing booking id to ignore (for updates)
 * @returns {Promise<{hasConflict: boolean, bookingConflicts: object[], maintenanceConflicts: object[]}>}
 */
async function findConflicts(resourceId, startTime, endTime, excludeBookingId = null) {
  const bookingQuery = {
    resource: resourceId,
    status: { $in: ['CONFIRMED', 'PENDING'] },
    $or: overlapClauses(startTime, endTime),
  };
  if (excludeBookingId) {
    bookingQuery._id = { $ne: excludeBookingId };
  }

  const [bookingConflicts, maintenanceLogs] = await Promise.all([
    Booking.find(bookingQuery).select('startTime endTime status purpose createdBy').lean(),
    MaintenanceLog.find({
      resource: resourceId,
      status: { $in: ['SCHEDULED', 'IN_PROGRESS'] },
    }).lean(),
  ]);

  const maintenanceConflicts = maintenanceLogs.filter((log) => {
    const { start, end } = maintenanceWindow(log);
    return start < endTime && end > startTime;
  });

  return {
    hasConflict: bookingConflicts.length > 0 || maintenanceConflicts.length > 0,
    bookingConflicts,
    maintenanceConflicts,
  };
}

/**
 * Suggests up to `limit` alternative time slots with the same duration as
 * [startTime, endTime), searching the requested day plus the following days
 * within standard operating hours, skipping anything that conflicts with an
 * existing Booking or MaintenanceLog entry.
 *
 * @param {ObjectId} resourceId
 * @param {Date} startTime
 * @param {Date} endTime
 * @param {object} [options]
 * @param {number} [options.limit=3]
 * @param {number} [options.searchDays=6]
 * @param {number} [options.openHour=8]
 * @param {number} [options.closeHour=20]
 * @param {number} [options.stepMinutes=30]
 * @returns {Promise<{startTime: Date, endTime: Date}[]>}
 */
async function suggestAlternatives(resourceId, startTime, endTime, options = {}) {
  const {
    limit = 3,
    searchDays = 6,
    openHour = 8,
    closeHour = 20,
    stepMinutes = 30,
  } = options;

  const duration = endTime.getTime() - startTime.getTime();

  const windowStart = new Date(startTime);
  const windowEnd = new Date(startTime);
  windowEnd.setDate(windowEnd.getDate() + searchDays + 1);

  const [bookings, maintenanceLogs] = await Promise.all([
    Booking.find({
      resource: resourceId,
      status: { $in: ['CONFIRMED', 'PENDING'] },
      startTime: { $lt: windowEnd },
      endTime: { $gt: windowStart },
    }).select('startTime endTime').lean(),
    MaintenanceLog.find({
      resource: resourceId,
      status: { $in: ['SCHEDULED', 'IN_PROGRESS'] },
    }).lean(),
  ]);

  const busy = [
    ...bookings.map((b) => ({ start: b.startTime, end: b.endTime })),
    ...maintenanceLogs.map(maintenanceWindow),
  ];

  const overlapsBusy = (start, end) => busy.some((b) => b.start < end && b.end > start);

  const suggestions = [];
  for (let dayOffset = 0; dayOffset <= searchDays && suggestions.length < limit; dayOffset++) {
    const dayOpen = new Date(startTime);
    dayOpen.setDate(dayOpen.getDate() + dayOffset);
    dayOpen.setHours(openHour, 0, 0, 0);

    const dayClose = new Date(dayOpen);
    dayClose.setHours(closeHour, 0, 0, 0);

    let candidateStart = dayOpen;
    if (dayOffset === 0) {
      candidateStart = new Date(Math.max(dayOpen.getTime(), endTime.getTime()));
      const remainder = candidateStart.getMinutes() % stepMinutes;
      if (remainder !== 0) {
        candidateStart.setMinutes(candidateStart.getMinutes() + (stepMinutes - remainder), 0, 0);
      }
    }

    while (candidateStart.getTime() + duration <= dayClose.getTime() && suggestions.length < limit) {
      const candidateEnd = new Date(candidateStart.getTime() + duration);

      if (!overlapsBusy(candidateStart, candidateEnd)) {
        suggestions.push({ startTime: new Date(candidateStart), endTime: candidateEnd });
      }

      candidateStart = new Date(candidateStart.getTime() + stepMinutes * 60 * 1000);
    }
  }

  return suggestions;
}

module.exports = { hasConflict, findConflicts, suggestAlternatives, maintenanceWindow };
