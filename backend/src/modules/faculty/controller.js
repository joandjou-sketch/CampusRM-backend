'use strict';

const { getFacultyStats } = require('./service');
const { sendSuccess } = require('../../utils/response');

/**
 * GET /api/v1/faculty/stats
 */
async function getStats(req, res, next) {
  try {
    const stats = await getFacultyStats(req.user._id);
    return sendSuccess(res, stats, 'Faculty stats retrieved');
  } catch (err) {
    return next(err);
  }
}

module.exports = { getStats };
