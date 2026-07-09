'use strict';

const express = require('express');
const router = express.Router();
const { register, login, logout, changePassword } = require('./controller');
const authenticate = require('../../middleware/authenticate');

router.post('/register',         register);
router.post('/login',            login);
router.post('/logout',           authenticate, logout);
router.post('/change-password',  authenticate, changePassword);

module.exports = router;
