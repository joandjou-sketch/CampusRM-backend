'use strict';

const Resource = require('../../models/Resource');
const Booking = require('../../models/Booking');
const Route = require('../../models/Route');
const BusSeatBooking = require('../../models/BusSeatBooking');
const TripLog = require('../../models/TripLog');
const MaintenanceLog = require('../../models/MaintenanceLog');
const User = require('../../models/User');
const { findConflicts, suggestAlternatives } = require('../shared/conflictDetection');
const { notify, notifyResourceManagerOrRole } = require('../../utils/notifier');

const MANAGER_ROLES = ['BUS_MANAGER', 'ADMIN'];
const ACTIVE_TRIP_STATUSES = ['PENDING', 'CONFIRMED', 'DELAYED'];
const ACTIVE_SEAT_STATUSES = ['CONFIRMED'];
const OPEN_MAINTENANCE_STATUSES = ['REPORTED', 'SCHEDULED', 'IN_PROGRESS'];
const CANCELLATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isManager(role) {
  return MANAGER_ROLES.includes(role);
}

/* ── Notifications ────────────────────────────────────────────────────── */

async function notifyBookingConfirmed(userId, trip) {
  await notify(userId, {
    title: 'Seat reservation confirmed',
    message: `Your seat on the ${trip.route?.name ?? 'scheduled'} trip is confirmed.`,
    type: 'BUS_SEAT_CONFIRMED',
    entityType: 'Booking',
    entityId: trip._id,
  });
}

async function notifyBookingCancelled(userId, trip) {
  await notify(userId, {
    title: 'Seat reservation cancelled',
    message: `Your seat on the ${trip.route?.name ?? 'scheduled'} trip has been cancelled.`,
    type: 'BUS_SEAT_CANCELLED',
    entityType: 'Booking',
    entityId: trip._id,
  });
}

async function notifyPassengers(passengerUserIds, trip, status) {
  const verb = status === 'CANCELLED' ? 'cancelled' : 'delayed';
  await Promise.all(
    passengerUserIds.map((userId) =>
      notify(userId, {
        title: `Trip ${verb}`,
        message: `Your trip on ${trip.route?.name ?? 'your route'} has been ${verb}.`,
        type: `BUS_TRIP_${status}`,
        entityType: 'Booking',
        entityId: trip._id,
      })
    )
  );
}

async function notifyMaintenanceDue(bus, log) {
  await notifyResourceManagerOrRole(bus, ['BUS_MANAGER'], {
    title: 'Bus maintenance scheduled',
    message: `Maintenance for "${bus.name}" is scheduled${
      log.scheduledDate ? ` for ${new Date(log.scheduledDate).toLocaleDateString()}` : ''
    }.`,
    type: 'BUS_MAINTENANCE_DUE',
    entityType: 'MaintenanceLog',
    entityId: log._id,
  });
}


/* ── Fleet management (BUS-21 add/edit/remove buses) ─────────────────────── */

async function addBus(user, { name, capacity, location, description }) {
  if (!name) throw httpError('name is required', 400);
  if (!capacity || capacity < 1) throw httpError('capacity must be a positive number', 400);

  return Resource.create({
    name,
    type: 'BUS',
    capacity,
    location,
    description,
    status: 'AVAILABLE',
    managedBy: user._id,
  });
}

async function listBuses() {
  return Resource.find({ type: 'BUS' }).lean();
}

async function getBusOrThrow(busId) {
  const bus = await Resource.findOne({ _id: busId, type: 'BUS' });
  if (!bus) throw httpError('Bus not found', 404);
  return bus;
}

async function updateBus(busId, updates) {
  const bus = await getBusOrThrow(busId);

  const { name, capacity, location, description } = updates;
  if (name !== undefined) bus.name = name;
  if (capacity !== undefined) {
    if (capacity < 1) throw httpError('capacity must be a positive number', 400);
    bus.capacity = capacity;
  }
  if (location !== undefined) bus.location = location;
  if (description !== undefined) bus.description = description;

  await bus.save();
  return bus;
}

/**
 * Retires a bus (soft delete): status becomes RETIRED and it is excluded
 * from search/booking/availability going forward.
 */
async function removeBus(busId) {
  const bus = await getBusOrThrow(busId);
  bus.status = 'RETIRED';
  await bus.save();
  return bus;
}

/* ── Route management (UC-21) ────────────────────────────────────────────── */

async function createRoute(user, { name, origin, destination, stops, schedule }) {
  if (!name || !origin || !destination) {
    throw httpError('name, origin and destination are required', 400);
  }
  return Route.create({ name, origin, destination, stops, schedule });
}

async function listRoutes() {
  return Route.find({ isActive: true }).lean();
}

async function getRouteOrThrow(routeId) {
  const route = await Route.findById(routeId);
  if (!route) throw httpError('Route not found', 404);
  return route;
}

async function updateRoute(routeId, updates) {
  const route = await getRouteOrThrow(routeId);

  const { name, origin, destination, stops, schedule } = updates;
  if (name !== undefined) route.name = name;
  if (origin !== undefined) route.origin = origin;
  if (destination !== undefined) route.destination = destination;
  if (stops !== undefined) route.stops = stops;
  if (schedule !== undefined) route.schedule = schedule;

  await route.save();
  return route;
}

/**
 * Retires a route (soft delete): it no longer appears in route search.
 */
async function removeRoute(routeId) {
  const route = await getRouteOrThrow(routeId);
  route.isActive = false;
  await route.save();
  return route;
}

/* ── Trip scheduling & conflict detection (BUS-01, BUS-02, RM-05) ────────── */

/**
 * Resource Manager/Admin schedules a bus on a route for a given date/time
 * window. Reuses the shared conflict-detection engine (overlapping Bookings
 * or active MaintenanceLog entries on the same bus). RM/Admin may override a
 * conflict in an emergency by supplying a mandatory justification (RM-05).
 */
async function scheduleTrip(user, { busId, routeId, date, departureTime, arrivalTime, override, justification }) {
  if (!busId || !routeId || !date || !departureTime || !arrivalTime) {
    throw httpError('busId, routeId, date, departureTime and arrivalTime are required', 400);
  }

  const start = new Date(`${date}T${departureTime}`);
  const end = new Date(`${date}T${arrivalTime}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError('date/departureTime/arrivalTime must form valid date-times', 400);
  }
  if (start >= end) throw httpError('arrivalTime must be after departureTime', 400);

  const bus = await getBusOrThrow(busId);
  if (bus.status === 'RETIRED') throw httpError('This bus is retired and cannot be scheduled', 400);

  await getRouteOrThrow(routeId);

  const conflictResult = await findConflicts(busId, start, end);
  let overridden = false;

  if (conflictResult.hasConflict) {
    if (!override) {
      const alternatives = await suggestAlternatives(busId, start, end);
      const err = new Error(
        'The requested time window conflicts with an existing trip or scheduled maintenance for this bus'
      );
      err.statusCode = 409;
      err.conflicts = {
        bookings: conflictResult.bookingConflicts,
        maintenance: conflictResult.maintenanceConflicts,
      };
      err.suggestedAlternatives = alternatives;
      throw err;
    }

    if (!isManager(user.role)) {
      throw httpError('Only a Bus Manager or Admin may override a booking conflict', 403);
    }
    if (!justification) {
      throw httpError('A justification is required to override a booking conflict', 400);
    }
    overridden = true;
  }

  let trip = await Booking.create({
    resource: busId,
    route: routeId,
    createdBy: user._id,
    startTime: start,
    endTime: end,
    status: 'CONFIRMED',
    approvedBy: user._id,
    purpose: `Scheduled trip on route ${routeId}`,
    notes: overridden ? `Conflict override: ${justification}` : undefined,
  });

  trip = await trip.populate(['resource', 'route']);

  return { trip, overridden, justification: overridden ? justification : undefined };
}

/**
 * Lists scheduled bus trips, optionally filtered by route and/or date.
 */
async function listTrips({ routeId, date } = {}) {
  const query = { route: { $exists: true }, status: { $in: ACTIVE_TRIP_STATUSES.concat(['COMPLETED']) } };
  if (routeId) query.route = routeId;

  if (date) {
    const dayStart = new Date(date);
    if (Number.isNaN(dayStart.getTime())) throw httpError('date must be a valid date', 400);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    query.startTime = { $gte: dayStart, $lte: dayEnd };
  }

  return Booking.find(query)
    .populate('resource', 'name capacity status')
    .populate('route', 'name origin destination')
    .sort({ startTime: 1 })
    .lean();
}

async function getTripOrThrow(tripId) {
  const trip = await Booking.findById(tripId).populate('resource').populate('route');
  if (!trip || !trip.route) throw httpError('Trip not found', 404);
  return trip;
}

/* ── Seat availability & reservations (UC-16/17/18/19/20) ────────────────── */

/**
 * Real-time seat availability for trips on a route/date: remaining seats =
 * bus capacity − confirmed seat bookings for that trip.
 */
async function getAvailability({ routeId, date }) {
  if (!routeId || !date) throw httpError('routeId and date query parameters are required', 400);

  const trips = await listTrips({ routeId, date });

  return Promise.all(
    trips.map(async (trip) => {
      const confirmedSeats = await BusSeatBooking.countDocuments({ trip: trip._id, status: { $in: ACTIVE_SEAT_STATUSES } });
      const capacity = trip.resource ? trip.resource.capacity || 0 : 0;
      return {
        tripId: trip._id,
        bus: trip.resource,
        route: trip.route,
        startTime: trip.startTime,
        endTime: trip.endTime,
        status: trip.status,
        capacity,
        seatsBooked: confirmedSeats,
        seatsAvailable: Math.max(0, capacity - confirmedSeats),
      };
    })
  );
}

/**
 * Reserves a seat on a scheduled trip (UC-18). Blocks the reservation once
 * the trip is full, or if the requested seat number is already taken.
 */
async function reserveSeat(user, { tripId, seatNo }) {
  if (!tripId) throw httpError('tripId is required', 400);

  const trip = await getTripOrThrow(tripId);
  if (!ACTIVE_TRIP_STATUSES.includes(trip.status)) {
    throw httpError(`Cannot reserve a seat on a trip with status ${trip.status}`, 400);
  }
  if (trip.startTime < new Date()) {
    throw httpError('Cannot reserve a seat on a trip that has already departed', 400);
  }

  const capacity = trip.resource ? trip.resource.capacity || 0 : 0;
  const confirmedSeats = await BusSeatBooking.countDocuments({ trip: tripId, status: { $in: ACTIVE_SEAT_STATUSES } });
  if (confirmedSeats >= capacity) {
    throw httpError('This trip is fully booked', 409);
  }

  if (seatNo != null) {
    const taken = await BusSeatBooking.exists({ trip: tripId, seatNo, status: { $in: ACTIVE_SEAT_STATUSES } });
    if (taken) throw httpError(`Seat ${seatNo} is already taken on this trip`, 409);
  }

  const booking = await BusSeatBooking.create({
    trip: tripId,
    route: trip.route._id,
    user: user._id,
    seatNo,
    status: 'CONFIRMED',
  });

  await notifyBookingConfirmed(user._id, trip);
  return booking;
}

async function getSeatBookingOrThrow(bookingId) {
  const booking = await BusSeatBooking.findById(bookingId).populate('trip');
  if (!booking) throw httpError('Bus booking not found', 404);
  return booking;
}

/**
 * Cancels a passenger's seat reservation (UC-19). Allowed only ≥ 2 hours
 * before departure; the seat is immediately returned to the pool.
 */
async function cancelReservation(user, bookingId) {
  const booking = await getSeatBookingOrThrow(bookingId);

  const isOwner = booking.user.toString() === user._id.toString();
  if (!isOwner && user.role !== 'ADMIN') {
    throw httpError('You are not authorized to cancel this booking', 403);
  }

  if (booking.status !== 'CONFIRMED') {
    throw httpError(`Cannot cancel a booking with status ${booking.status}`, 400);
  }

  const trip = booking.trip;
  if (trip.startTime.getTime() - Date.now() < CANCELLATION_WINDOW_MS) {
    throw httpError('Reservations can only be cancelled at least 2 hours before departure', 400);
  }

  booking.status = 'CANCELLED';
  await booking.save();

  await notifyBookingCancelled(booking.user, trip);
  return booking;
}

/**
 * Returns a user's bus booking history (UC-20). Self or Admin/Resource Manager.
 */
async function getUserBookingHistory(targetUserId, requester) {
  const isSelf = requester._id.toString() === targetUserId.toString();
  if (!isSelf && !isManager(requester.role)) {
    throw httpError('You are not authorized to view this booking history', 403);
  }

  return BusSeatBooking.find({ user: targetUserId })
    .populate({ path: 'trip', populate: { path: 'resource', select: 'name capacity' } })
    .populate('route', 'name origin destination')
    .sort({ createdAt: -1 })
    .lean();
}

/* ── Delay / cancellation (UC-24) ────────────────────────────────────────── */

/**
 * Resource Manager marks a scheduled trip as delayed, cancelled, confirmed,
 * or completed. Delays and cancellations notify every passenger with a
 * confirmed seat; a cancellation also frees those seats.
 */
async function updateTripStatus(user, tripId, { status, reason }) {
  if (!['DELAYED', 'CANCELLED', 'CONFIRMED', 'COMPLETED'].includes(status)) {
    throw httpError(`Invalid trip status: ${status}`, 400);
  }

  const trip = await getTripOrThrow(tripId);
  trip.status = status;
  if (reason) trip.notes = reason;
  await trip.save();

  if (status === 'DELAYED' || status === 'CANCELLED') {
    const seatBookings = await BusSeatBooking.find({ trip: tripId, status: { $in: ACTIVE_SEAT_STATUSES } });

    if (status === 'CANCELLED') {
      await BusSeatBooking.updateMany(
        { trip: tripId, status: { $in: ACTIVE_SEAT_STATUSES } },
        { status: 'CANCELLED' }
      );
    }

    await notifyPassengers(seatBookings.map((b) => b.user), trip, status);
  }

  return trip;
}

/* ── Trip logging (BUS-03) ───────────────────────────────────────────────── */

/**
 * Records the operational details of an executed trip: driver, odometer
 * start/end (feeds the utilisation dashboard), purpose, and timestamps.
 */
async function logTrip(user, tripId, { odometerStart, odometerEnd, purpose, departedAt, returnedAt }) {
  if (odometerStart == null) {
    throw httpError('odometerStart is required', 400);
  }
  if (odometerEnd != null && odometerEnd < odometerStart) {
    throw httpError('odometerEnd cannot be less than odometerStart', 400);
  }

  const trip = await getTripOrThrow(tripId);

  return TripLog.create({
    trip: tripId,
    bus: trip.resource._id,
    route: trip.route._id,
    odometerStart,
    odometerEnd,
    purpose,
    departedAt,
    returnedAt,
    recordedBy: user._id,
  });
}

/* ── Maintenance scheduling (BUS-04) ─────────────────────────────────────── */

/**
 * Schedules preventive maintenance for a bus and marks it UNDER_MAINTENANCE
 * (mapped to the shared Resource status MAINTENANCE), excluding it from
 * search/booking until resolved.
 */
async function scheduleMaintenance(user, busId, { type, description, scheduledDate, priority, assignedTo, notes }) {
  if (!scheduledDate) throw httpError('scheduledDate is required', 400);

  const bus = await getBusOrThrow(busId);

  const log = await MaintenanceLog.create({
    resource: busId,
    description: description || type || 'Scheduled maintenance',
    reportedBy: user._id,
    priority,
    scheduledDate,
    assignedTo,
    resolutionNotes: notes,
    status: 'SCHEDULED',
  });

  if (bus.status !== 'RETIRED') {
    bus.status = 'MAINTENANCE';
    await bus.save();
  }

  await notifyMaintenanceDue(bus, { ...log.toObject(), type });
  return log;
}

/**
 * Marks a maintenance entry resolved and, if no other open maintenance
 * entries remain, restores the bus to AVAILABLE.
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
    const bus = await Resource.findById(log.resource);
    if (bus && bus.status === 'MAINTENANCE') {
      bus.status = 'AVAILABLE';
      await bus.save();
    }
  }

  return log;
}

/* ── Occupancy & utilisation reporting (UC-22/23, BUS-05) ────────────────── */

/**
 * Per-bus occupancy (seats booked vs. capacity) and utilisation (trips, km
 * travelled) over [from, to].
 */
async function getOccupancyReport(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw httpError('from and to must be valid dates with from before to', 400);
  }

  const buses = await Resource.find({ type: 'BUS' }).lean();

  const report = await Promise.all(
    buses.map(async (bus) => {
      const trips = await Booking.find({
        resource: bus._id,
        route: { $exists: true },
        startTime: { $gte: start, $lte: end },
      }).select('_id').lean();

      const tripIds = trips.map((t) => t._id);

      const [seatCounts, tripLogs] = await Promise.all([
        BusSeatBooking.aggregate([
          { $match: { trip: { $in: tripIds }, status: { $in: ACTIVE_SEAT_STATUSES } } },
          { $group: { _id: '$trip', count: { $sum: 1 } } },
        ]),
        TripLog.find({ bus: bus._id, departedAt: { $gte: start, $lte: end } }).lean(),
      ]);

      const totalSeatsBooked = seatCounts.reduce((sum, s) => sum + s.count, 0);
      const totalCapacity = trips.length * (bus.capacity || 0);
      const occupancyPercent = totalCapacity > 0 ? round2((totalSeatsBooked / totalCapacity) * 100) : 0;

      const kmTravelled = tripLogs.reduce((sum, log) => {
        if (log.odometerEnd == null) return sum;
        return sum + Math.max(0, log.odometerEnd - log.odometerStart);
      }, 0);

      return {
        busId: bus._id,
        name: bus.name,
        capacity: bus.capacity,
        status: bus.status,
        trips: trips.length,
        seatsBooked: totalSeatsBooked,
        occupancyPercent,
        kmTravelled: round2(kmTravelled),
      };
    })
  );

  return { from: start, to: end, buses: report };
}

module.exports = {
  addBus,
  listBuses,
  updateBus,
  removeBus,
  createRoute,
  listRoutes,
  updateRoute,
  removeRoute,
  scheduleTrip,
  listTrips,
  getAvailability,
  reserveSeat,
  cancelReservation,
  getUserBookingHistory,
  updateTripStatus,
  logTrip,
  scheduleMaintenance,
  completeMaintenance,
  getOccupancyReport,
};
