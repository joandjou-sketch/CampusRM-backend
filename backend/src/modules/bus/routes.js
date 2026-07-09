'use strict';

const express = require('express');
const router = express.Router();

const {
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
} = require('./controller');

const { authenticate, authorize } = require('../shared');

/* ── Utilisation reporting (UC-22/23, BUS-05, Resource Manager/Admin) ────── */
router.get('/reports/occupancy', authenticate, authorize('BUS_MANAGER', 'ADMIN'), getOccupancyStats);

/* ── Seat availability & reservations (UC-16/17/18/19/20) ────────────────── */
const NON_STUDENT = authorize('FACULTY', 'BUS_MANAGER');
router.get('/availability', authenticate, NON_STUDENT, getAvailabilityStats);
router.post('/bookings', authenticate, NON_STUDENT, reserveSeatEntry);
router.delete('/bookings/:id', authenticate, NON_STUDENT, cancelReservationEntry);
router.get('/bookings/user/:id', authenticate, NON_STUDENT, getUserBookingHistoryEntry);

/* ── Fleet management (Resource Manager/Admin) ───────────────────────────── */
router.post('/buses', authenticate, authorize('BUS_MANAGER'), addBusEntry);
router.get('/buses', authenticate, getBuses);
router.put('/buses/:id', authenticate, authorize('BUS_MANAGER'), updateBusEntry);
router.delete('/buses/:id', authenticate, authorize('BUS_MANAGER'), removeBusEntry);

/* ── Maintenance scheduling (BUS-04) ─────────────────────────────────────── */
router.post('/buses/:id/maintenance', authenticate, authorize('BUS_MANAGER'), scheduleMaintenanceEntry);
router.put('/maintenance/:id/complete', authenticate, authorize('BUS_MANAGER'), completeMaintenanceEntry);

/* ── Route management (UC-21) ────────────────────────────────────────────── */
router.post('/routes', authenticate, authorize('BUS_MANAGER'), createRouteEntry);
router.get('/routes', authenticate, getRoutes);
router.put('/routes/:id', authenticate, authorize('BUS_MANAGER'), updateRouteEntry);
router.delete('/routes/:id', authenticate, authorize('BUS_MANAGER'), removeRouteEntry);

/* ── Trip scheduling & conflict detection (BUS-01, BUS-02, RM-05) ────────── */
router.post('/trips', authenticate, authorize('BUS_MANAGER'), scheduleTripEntry);
router.get('/trips', authenticate, getTrips);

/* ── Delay / cancellation (UC-24) ────────────────────────────────────────── */
router.put('/trips/:id/status', authenticate, authorize('BUS_MANAGER'), updateTripStatusEntry);

/* ── Trip logging (BUS-03) ───────────────────────────────────────────────── */
router.post('/trips/:id/log', authenticate, authorize('BUS_MANAGER'), logTripEntry);

module.exports = router;
