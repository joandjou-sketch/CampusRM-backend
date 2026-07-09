'use strict';

const express = require('express');
const router = express.Router();

const { getStats } = require('./controller');
const { authenticate, authorize } = require('../shared');

/* Faculty Dashboard is also shown to STAFF accounts (see frontend RoleRoute). */
router.get('/stats', authenticate, authorize('FACULTY', 'STAFF'), getStats);

module.exports = router;
