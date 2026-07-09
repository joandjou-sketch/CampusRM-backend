'use strict';

const express = require('express');
const router = express.Router();

const {
  getUsers, approveUserAccount, rejectUserAccount, blockUserAccount, unblockUserAccount, deleteUserAccount,
  getUsersByRoleStats,
  getRegistry, getBadgeCounts,
  getStats, getActivity, getAuditFlags,
  getAuditLog, getDashboardCharts,
} = require('./controller');
const { authenticate, authorize } = require('../shared');

/* Badge counts — accessible to ADMIN, LAB_MANAGER and EQUIPMENT_MANAGER. */
router.get('/badge-counts', authenticate, authorize('ADMIN', 'LAB_MANAGER', 'EQUIPMENT_MANAGER', 'LIBRARIAN'), getBadgeCounts);

/* Every route below this line is admin-only. */
router.use(authenticate, authorize('ADMIN'));

router.get('/stats', getStats);
router.get('/dashboard-charts', getDashboardCharts);
router.get('/activity', getActivity);
router.get('/audit-flags', getAuditFlags);
router.get('/audit-log', getAuditLog);

router.get('/users', getUsers);
router.get('/users/by-role', getUsersByRoleStats);
router.patch('/users/:id/approve', approveUserAccount);
router.patch('/users/:id/reject', rejectUserAccount);
router.patch('/users/:id/block', blockUserAccount);
router.patch('/users/:id/unblock', unblockUserAccount);
router.delete('/users/:id', deleteUserAccount);
router.get('/registry', getRegistry);

module.exports = router;
