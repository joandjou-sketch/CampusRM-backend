'use strict';

const Booking = require('../../models/Booking');

/**
 * Every PENDING booking across resource types (lab, equipment, bus), for a
 * resource manager's approvals inbox. Each manager's page filters this down
 * to the resource type it owns (see EquipmentApprovalsPage).
 */
async function getPendingApprovals() {
  return Booking.find({ status: 'PENDING' })
    .populate('resource', 'name type location capacity')
    .populate('createdBy', 'fullName email role')
    .sort({ startTime: 1 })
    .lean();
}

module.exports = { getPendingApprovals };
