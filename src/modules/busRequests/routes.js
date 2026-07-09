'use strict';

const express = require('express');
const router = express.Router();

const {
  submitRequestEntry,
  listRequestsEntry,
  getMyRequestsEntry,
  approveRequestEntry,
  rejectRequestEntry,
  exportRequestEntry,
} = require('./controller');

const { authenticate, authorize } = require('../shared');

/* Faculty submits a new trip request */
router.post('/', authenticate, authorize('FACULTY'), submitRequestEntry);

/* Faculty views their own requests */
router.get('/me', authenticate, authorize('FACULTY'), getMyRequestsEntry);

/* Bus Manager views all requests (optional ?status=PENDING|APPROVED|REJECTED) */
router.get('/', authenticate, authorize('BUS_MANAGER'), listRequestsEntry);

/* Bus Manager exports a request as a printable HTML form */
router.get('/:id/export', authenticate, authorize('BUS_MANAGER'), exportRequestEntry);

/* Bus Manager approves a request */
router.put('/:id/approve', authenticate, authorize('BUS_MANAGER'), approveRequestEntry);

/* Bus Manager rejects a request with a reason */
router.put('/:id/reject', authenticate, authorize('BUS_MANAGER'), rejectRequestEntry);

module.exports = router;
