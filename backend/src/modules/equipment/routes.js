'use strict';

const express = require('express');
const router = express.Router();

const {
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
} = require('./controller');

const { authenticate, authorize } = require('../shared');

/* ── Usage reporting (UC-32, Resource Manager/Admin) ─────────────────────── */
router.get('/reports/usage', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), getUsageStats);

/* ── Status & approval workflow (UC-27, UC-29) ───────────────────────────── */
router.get('/bookings/me', authenticate, getMyEquipmentBookings);
router.put('/bookings/:id/approve', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), approveEquipmentBooking);
router.put('/bookings/:id/reject', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), rejectEquipmentBooking);

/* ── Check-in (UC-04, IT-02/IT-03) ───────────────────────────────────────── */
router.put('/checkin/:checkoutId', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), checkinEquipmentItem);
router.get('/checkout/overdue', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), getOverdueEquipmentCheckouts);

/* ── Maintenance logging (UC-30) ─────────────────────────────────────────── */
router.put('/maintenance/:id/complete', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), completeEquipmentMaintenance);

/* ── Borrower's checked-out equipment & self-reported returns ─────────────── */
router.get('/my-checkouts', authenticate, getMyEquipmentCheckouts);
router.post('/my-checkouts/:checkoutId/return-request', authenticate, requestEquipmentReturn);

/* ── Borrower-marked returns awaiting manager confirmation ────────────────── */
router.get('/returns/pending', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), getPendingEquipmentReturns);
router.put('/returns/:checkoutId/deny', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), denyEquipmentReturn);

/* ── Equipment-specific user access management (not full account) ────────── */
/* Mirrors the library's user-management access: EQUIPMENT_MANAGER can act, ADMIN has view-only access. */
router.get('/users', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), getEquipmentUsersController);
router.put('/users/:id/block', authenticate, authorize('EQUIPMENT_MANAGER'), blockEquipmentAccessController);
router.put('/users/:id/unblock', authenticate, authorize('EQUIPMENT_MANAGER'), unblockEquipmentAccessController);

/* ── Inventory & real-time availability (UC-25, IT-01) ───────────────────── */
router.get('/', authenticate, getEquipmentList);
router.get('/:id', authenticate, getEquipmentItem);

/* ── Checkout request flow (UC-26) ───────────────────────────────────────── */
router.post('/:id/request', authenticate, requestEquipmentCheckout);

/* ── Maintenance logging (UC-30) ─────────────────────────────────────────── */
router.post('/:id/maintenance', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), logEquipmentMaintenance);
router.get('/:id/maintenance', authenticate, authorize('EQUIPMENT_MANAGER', 'ADMIN'), getEquipmentMaintenanceHistory);

module.exports = router;
