'use strict';

const {
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
} = require('./service');
const { sendSuccess, sendError } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');
const { sendCsv } = require('../../utils/csv');
const { streamTablePdf } = require('../../utils/pdf');

/* ── Fleet management ─────────────────────────────────────────────────────── */

async function addBusEntry(req, res, next) {
  try {
    const bus = await addBus(req.user, req.body);
    await logAction(req.user._id, 'BUS_ADDED', 'Resource', bus._id, { name: bus.name, capacity: bus.capacity }, req.ip);
    return sendSuccess(res, bus, 'Bus added to fleet', 201);
  } catch (err) {
    return next(err);
  }
}

async function getBuses(req, res, next) {
  try {
    const buses = await listBuses();
    return sendSuccess(res, buses, 'Buses retrieved');
  } catch (err) {
    return next(err);
  }
}

async function updateBusEntry(req, res, next) {
  try {
    const bus = await updateBus(req.params.id, req.body);
    await logAction(req.user._id, 'BUS_UPDATED', 'Resource', bus._id, req.body, req.ip);
    return sendSuccess(res, bus, 'Bus updated');
  } catch (err) {
    return next(err);
  }
}

async function removeBusEntry(req, res, next) {
  try {
    const bus = await removeBus(req.params.id);
    await logAction(req.user._id, 'BUS_RETIRED', 'Resource', bus._id, {}, req.ip);
    return sendSuccess(res, bus, 'Bus retired');
  } catch (err) {
    return next(err);
  }
}

/* ── Route management (UC-21) ────────────────────────────────────────────── */

async function createRouteEntry(req, res, next) {
  try {
    const route = await createRoute(req.user, req.body);
    await logAction(req.user._id, 'ROUTE_CREATED', 'Route', route._id, { name: route.name }, req.ip);
    return sendSuccess(res, route, 'Route created', 201);
  } catch (err) {
    return next(err);
  }
}

async function getRoutes(req, res, next) {
  try {
    const routes = await listRoutes();
    return sendSuccess(res, routes, 'Routes retrieved');
  } catch (err) {
    return next(err);
  }
}

async function updateRouteEntry(req, res, next) {
  try {
    const route = await updateRoute(req.params.id, req.body);
    await logAction(req.user._id, 'ROUTE_UPDATED', 'Route', route._id, req.body, req.ip);
    return sendSuccess(res, route, 'Route updated');
  } catch (err) {
    return next(err);
  }
}

async function removeRouteEntry(req, res, next) {
  try {
    const route = await removeRoute(req.params.id);
    await logAction(req.user._id, 'ROUTE_RETIRED', 'Route', route._id, {}, req.ip);
    return sendSuccess(res, route, 'Route retired');
  } catch (err) {
    return next(err);
  }
}

/* ── Trip scheduling & conflict detection (BUS-01, BUS-02, RM-05) ────────── */

async function scheduleTripEntry(req, res, next) {
  try {
    const { trip, overridden, justification } = await scheduleTrip(req.user, req.body);

    await logAction(
      req.user._id,
      overridden ? 'BUS_TRIP_SCHEDULED_WITH_OVERRIDE' : 'BUS_TRIP_SCHEDULED',
      'Booking',
      trip._id,
      { bus: req.body.busId, route: req.body.routeId, startTime: trip.startTime, endTime: trip.endTime, justification },
      req.ip
    );

    return sendSuccess(res, trip, 'Trip scheduled', 201);
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

async function getTrips(req, res, next) {
  try {
    const { routeId, date } = req.query;
    const trips = await listTrips({ routeId, date });
    return sendSuccess(res, trips, 'Trips retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Seat availability & reservations (UC-16/17/18/19/20) ────────────────── */

async function getAvailabilityStats(req, res, next) {
  try {
    const { routeId, date } = req.query;
    const availability = await getAvailability({ routeId, date });
    return sendSuccess(res, availability, 'Seat availability retrieved');
  } catch (err) {
    return next(err);
  }
}

async function reserveSeatEntry(req, res, next) {
  try {
    const booking = await reserveSeat(req.user, req.body);
    await logAction(req.user._id, 'BUS_SEAT_BOOKED', 'BusSeatBooking', booking._id, {
      trip: req.body.tripId,
      seatNo: req.body.seatNo,
    }, req.ip);
    return sendSuccess(res, booking, 'Seat reserved', 201);
  } catch (err) {
    return next(err);
  }
}

async function cancelReservationEntry(req, res, next) {
  try {
    const booking = await cancelReservation(req.user, req.params.id);
    await logAction(req.user._id, 'BUS_SEAT_CANCELLED', 'BusSeatBooking', booking._id, {}, req.ip);
    return sendSuccess(res, booking, 'Reservation cancelled');
  } catch (err) {
    return next(err);
  }
}

async function getUserBookingHistoryEntry(req, res, next) {
  try {
    const bookings = await getUserBookingHistory(req.params.id, req.user);
    return sendSuccess(res, bookings, 'Booking history retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Delay / cancellation (UC-24) ────────────────────────────────────────── */

async function updateTripStatusEntry(req, res, next) {
  try {
    const { status, reason } = req.body;
    const trip = await updateTripStatus(req.user, req.params.id, { status, reason });
    await logAction(req.user._id, 'BUS_TRIP_STATUS_CHANGED', 'Booking', trip._id, { status, reason }, req.ip);
    return sendSuccess(res, trip, 'Trip status updated');
  } catch (err) {
    return next(err);
  }
}

/* ── Trip logging (BUS-03) ───────────────────────────────────────────────── */

async function logTripEntry(req, res, next) {
  try {
    const log = await logTrip(req.user, req.params.id, req.body);
    await logAction(req.user._id, 'BUS_TRIP_LOGGED', 'TripLog', log._id, {
      trip: req.params.id,
      odometerStart: log.odometerStart,
      odometerEnd: log.odometerEnd,
    }, req.ip);
    return sendSuccess(res, log, 'Trip log recorded', 201);
  } catch (err) {
    return next(err);
  }
}

/* ── Maintenance scheduling (BUS-04) ─────────────────────────────────────── */

async function scheduleMaintenanceEntry(req, res, next) {
  try {
    const log = await scheduleMaintenance(req.user, req.params.id, req.body);
    await logAction(req.user._id, 'BUS_MAINTENANCE_SCHEDULED', 'MaintenanceLog', log._id, {
      bus: req.params.id,
      scheduledDate: log.scheduledDate,
      description: log.description,
    }, req.ip);
    return sendSuccess(res, log, 'Maintenance scheduled', 201);
  } catch (err) {
    return next(err);
  }
}

async function completeMaintenanceEntry(req, res, next) {
  try {
    const { resolutionNotes } = req.body;
    const log = await completeMaintenance(req.params.id, resolutionNotes);
    await logAction(req.user._id, 'BUS_MAINTENANCE_RESOLVED', 'MaintenanceLog', log._id, { resolutionNotes }, req.ip);
    return sendSuccess(res, log, 'Maintenance marked resolved');
  } catch (err) {
    return next(err);
  }
}

/* ── Occupancy & utilisation reporting (UC-22/23, BUS-05) ────────────────── */

async function getOccupancyStats(req, res, next) {
  try {
    const { from, to } = req.query;
    const format = (req.query.format || 'json').toLowerCase();

    if (!from || !to) {
      return sendError(res, 'from and to query parameters are required', 400);
    }
    if (!['json', 'csv', 'pdf'].includes(format)) {
      return sendError(res, 'format must be one of: json, csv, pdf', 400);
    }

    const report = await getOccupancyReport(from, to);

    const columns = [
      { label: 'Bus ID', value: (b) => b.busId },
      { label: 'Name', value: (b) => b.name },
      { label: 'Capacity', value: (b) => (b.capacity ?? '') },
      { label: 'Status', value: (b) => b.status },
      { label: 'Trips', value: (b) => b.trips },
      { label: 'Seats Booked', value: (b) => b.seatsBooked },
      { label: 'Occupancy %', value: (b) => b.occupancyPercent },
      { label: 'Km Travelled', value: (b) => b.kmTravelled },
    ];

    if (format === 'csv') {
      return sendCsv(res, `bus-occupancy-${from}-to-${to}.csv`, report.buses, columns);
    }

    if (format === 'pdf') {
      return streamTablePdf(res, {
        title: 'Bus Occupancy Report',
        subtitle: `Period: ${from} to ${to}`,
        filename: `bus-occupancy-${from}-to-${to}.pdf`,
        columns,
        rows: report.buses,
      });
    }

    return sendSuccess(res, report, 'Occupancy report generated');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  addBusEntry,
  getBuses,
  updateBusEntry,
  removeBusEntry,
  createRouteEntry,
  getRoutes,
  updateRouteEntry,
  removeRouteEntry,
  scheduleTripEntry,
  getTrips,
  getAvailabilityStats,
  reserveSeatEntry,
  cancelReservationEntry,
  getUserBookingHistoryEntry,
  updateTripStatusEntry,
  logTripEntry,
  scheduleMaintenanceEntry,
  completeMaintenanceEntry,
  getOccupancyStats,
};
