'use strict';

const mongoose = require('mongoose');

/**
 * Resource schema — represents any bookable/checkable campus asset.
 * type distinguishes rooms, labs, equipment, etc.
 */
const resourceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Resource name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['ROOM', 'EQUIPMENT', 'LAB', 'BUS', 'OTHER'],
      required: [true, 'Resource type is required'],
    },
    location: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'BOOKED', 'CHECKED_OUT', 'MAINTENANCE', 'RETIRED'],
      default: 'AVAILABLE',
    },
    capacity: {
      type: Number,
      min: 1,
    },
    totalCopies: {
      type: Number,
      min: 0,
    },
    availableCopies: {
      type: Number,
      min: 0,
    },
    tags: [{ type: String, trim: true }],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    managedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Returns available time slots for this resource (stub — modules override with real logic).
 */
resourceSchema.methods.getAvailability = async function () {
  return { resourceId: this._id, status: this.status };
};

/**
 * Returns true when the resource can accept new bookings.
 */
resourceSchema.methods.isBookable = function () {
  return this.status === 'AVAILABLE';
};

/**
 * Updates the status field and persists the change.
 * @param {string} newStatus - One of AVAILABLE | BOOKED | MAINTENANCE | RETIRED
 */
resourceSchema.methods.updateStatus = async function (newStatus) {
  this.status = newStatus;
  return this.save();
};

module.exports = mongoose.model('Resource', resourceSchema);
