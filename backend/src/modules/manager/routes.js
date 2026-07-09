'use strict';

const express = require('express');
const router = express.Router();

const { getPending } = require('./controller');
const { authenticate, authorize } = require('../shared');

router.get(
  '/approvals/pending',
  authenticate,
  authorize('LAB_MANAGER', 'EQUIPMENT_MANAGER', 'BUS_MANAGER', 'LIBRARIAN', 'ADMIN'),
  getPending
);

module.exports = router;
