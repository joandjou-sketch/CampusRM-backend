'use strict';

const mongoose = require('mongoose');

/**
 * MaintenanceLog schema — records maintenance events for a Resource.
 * Lifecycle: REPORTED → SCHEDULED → IN_PROGRESS → RESOLVED
 */
const maintenanceLogSchema = new mongoose.Schema(
  {
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: [true, 'Resource is required'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reporter is required'],
    },
    reportDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['REPORTED', 'SCHEDULED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
      default: 'REPORTED',
    },
    scheduledDate: {
      type: Date,
    },
    resolvedDate: {
      type: Date,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Schedules maintenance for a given date and assigns a technician.
 * @param {Date} scheduledDate
 * @param {ObjectId} assignedTo - User id of the technician
 */
maintenanceLogSchema.methods.schedule = async function (scheduledDate, assignedTo) {
  this.scheduledDate = scheduledDate;
  if (assignedTo) this.assignedTo = assignedTo;
  this.status = 'SCHEDULED';
  return this.save();
};

/**
 * Updates the status of this maintenance log.
 * @param {string} newStatus
 */
maintenanceLogSchema.methods.updateStatus = async function (newStatus) {
  this.status = newStatus;
  return this.save();
};

/**
 * Marks the maintenance as resolved with optional resolution notes.
 * @param {string} notes
 */
maintenanceLogSchema.methods.resolve = async function (notes) {
  this.status = 'RESOLVED';
  this.resolvedDate = new Date();
  if (notes) this.resolutionNotes = notes;
  return this.save();
};

module.exports = mongoose.model('MaintenanceLog', maintenanceLogSchema);
