'use strict';

const { sendError } = require('../../utils/response');

/**
 * RBAC middleware factory.
 * Usage: router.get('/admin', requireRoles('ADMIN'), controller.fn)
 *
 * @param {...string} roles - Allowed role strings (e.g. 'ADMIN', 'LIBRARIAN')
 * @returns {import('express').RequestHandler}
 */
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required', 401);
    }
    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        `Access denied. Required role(s): ${roles.join(', ')}`,
        403
      );
    }
    return next();
  };
}

module.exports = { requireRoles };
