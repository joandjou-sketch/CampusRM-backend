'use strict';

const { sendError } = require('../utils/response');

/**
 * Higher-order function that returns an Express middleware enforcing role access.
 * Must be used AFTER authenticate middleware.
 *
 * Usage: router.delete('/resource/:id', authenticate, authorize('ADMIN', 'EQUIPMENT_MANAGER'), controller.fn)
 *
 * @param {...string} allowedRoles
 * @returns {import('express').RequestHandler}
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }
    if (!allowedRoles.includes(req.user.role)) {
      return sendError(res, `Access denied. Allowed roles: ${allowedRoles.join(', ')}`, 403);
    }
    return next();
  };
}

module.exports = authorize;
