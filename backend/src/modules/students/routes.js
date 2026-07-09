'use strict';

const express = require('express');
const router = express.Router();

const { getMyStats } = require('./controller');
const { authenticate, authorize } = require('../shared');

router.get('/me/stats', authenticate, authorize('STUDENT'), getMyStats);

module.exports = router;
