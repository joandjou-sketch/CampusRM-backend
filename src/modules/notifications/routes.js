'use strict';

const express = require('express');
const router = express.Router();

const { getMyNotifications, markNotificationRead, markAllNotificationsRead } = require('./controller');
const { authenticate } = require('../shared');

/* Available to any authenticated role — each user only ever sees their own notifications. */
router.use(authenticate);

router.get('/', getMyNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

module.exports = router;
