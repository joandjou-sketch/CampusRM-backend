'use strict';

const { sendError } = require('../utils/response');

/**
 * 404 handler — must be registered AFTER all routes.
 */
function notFoundHandler(req, res) {
  sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

/**
 * Generic error handler — catches errors thrown by any route or middleware.
 * Express identifies 4-argument functions as error handlers.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(`[ErrorHandler] ${err.stack || err.message}`);

  /* Mongoose validation error */
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return sendError(res, messages.join(', '), 422);
  }

  /* Mongoose duplicate key */
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return sendError(res, `Duplicate value for field: ${field}`, 409);
  }

  /* JWT errors */
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Invalid token', 401);
  }
  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Token expired', 401);
  }

  /* Mongoose CastError (invalid ObjectId) */
  if (err.name === 'CastError') {
    return sendError(res, `Invalid id: ${err.value}`, 400);
  }

  const statusCode = err.statusCode || 500;
  return sendError(res, err.message || 'Internal server error', statusCode);
}

module.exports = { notFoundHandler, errorHandler };
