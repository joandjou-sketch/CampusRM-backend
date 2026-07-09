'use strict';

const { getPendingApprovals } = require('./service');
const { sendSuccess } = require('../../utils/response');

/**
 * GET /api/v1/manager/approvals/pending
 */
async function getPending(req, res, next) {
  try {
    const approvals = await getPendingApprovals();
    return sendSuccess(res, approvals, 'Pending approvals retrieved');
  } catch (err) {
    return next(err);
  }
}

module.exports = { getPending };
