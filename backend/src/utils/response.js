'use strict';

/**
 * Consistent JSON response envelope used by every module.
 * Shape: { success, data, error, meta }
 */

/**
 * Sends a success response.
 * @param {import('express').Response} res
 * @param {*} data - Payload to return
 * @param {string} [message]
 * @param {number} [statusCode=200]
 * @param {object} [meta] - Pagination or extra metadata
 */
function sendSuccess(res, data, message = 'OK', statusCode = 200, meta = null) {
  const body = { success: true, data, error: null };
  if (message) body.message = message;
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

/**
 * Sends an error response.
 * @param {import('express').Response} res
 * @param {string} message - Human-readable error message
 * @param {number} [statusCode=500]
 * @param {*} [details] - Extra debug info (omitted in production)
 * @param {object} [extra] - Additional top-level fields merged into the response body (e.g. { data: {...} })
 */
function sendError(res, message, statusCode = 500, details = null, extra = null) {
  const body = { success: false, data: null, error: { message } };
  if (details && process.env.NODE_ENV !== 'production') {
    body.error.details = details;
  }
  if (extra) Object.assign(body, extra);
  return res.status(statusCode).json(body);
}

module.exports = { sendSuccess, sendError };
