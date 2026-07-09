'use strict';

const { getStudentStats } = require('./service');
const { sendSuccess } = require('../../utils/response');

/**
 * GET /api/v1/students/me/stats
 */
async function getMyStats(req, res, next) {
  try {
    const stats = await getStudentStats(req.user._id);
    return sendSuccess(res, stats, 'Student stats retrieved');
  } catch (err) {
    return next(err);
  }
}

module.exports = { getMyStats };
