'use strict';

const express = require('express');
const router = express.Router();

const {
  getLabs,
  getSchedule,
  bookLab,
  getMyLabBookings,
  approveLabBooking,
  rejectLabBooking,
  cancelLabBooking,
  getUtilizationStats,
} = require('./controller');

const { authenticate, authorize } = require('../shared');

/* ── Reporting (UC-40, Resource Manager/Admin) ───────────────────────────── */
router.get('/reports/utilization', authenticate, authorize('LAB_MANAGER', 'ADMIN'), getUtilizationStats);

/* ── Status & approval workflow (UC-36, UC-37) ───────────────────────────── */
router.get('/bookings/me', authenticate, getMyLabBookings);
router.put('/bookings/:id/approve', authenticate, authorize('LAB_MANAGER', 'ADMIN'), approveLabBooking);
router.put('/bookings/:id/reject', authenticate, authorize('LAB_MANAGER', 'ADMIN'), rejectLabBooking);

/* ── Cancellation (UC-38) ─────────────────────────────────────────────────── */
router.delete('/bookings/:id', authenticate, cancelLabBooking);

/* ── Schedule viewing (GEN-06 / UC-34, read-only for all authenticated users) */
router.get('/', authenticate, getLabs);
router.get('/:id/schedule', authenticate, getSchedule);

/* ── Booking requests & conflict detection (UC-35, LAB-02) ───────────────── */
router.post('/:id/book', authenticate, bookLab);

module.exports = router;
