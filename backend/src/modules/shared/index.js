'use strict';

/**
 * Shared middleware barrel — teammates import from here:
 *   const { authenticate, authorize } = require('../shared');
 */
const authenticate = require('../../middleware/authenticate');
const authorize    = require('../../middleware/authorize');
const { requireRoles } = require('./rbac');
const { hasConflict, findConflicts, suggestAlternatives, maintenanceWindow } = require('./conflictDetection');
const { log }          = require('./auditLogger');

module.exports = {
  authenticate,
  authorize,
  requireRoles,
  hasConflict,
  findConflicts,
  suggestAlternatives,
  maintenanceWindow,
  log,
};
