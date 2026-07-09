'use strict';

const mongoose = require('mongoose');

/**
 * Booking schema — records a time-bound reservation of a Resource by a User.
 * Conflict detection runs before confirm() is called.
 */
const bookingSchema = new mongoose.Schema(
  {
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: [true, 'Resource is required'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'REJECTED', 'DELAYED'],
      default: 'PENDING',
    },
    purpose: {
      type: String,
      trim: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    notes: {
      type: String,
      trim: true,
    },

  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** Index for fast conflict queries on resource + time window */
bookingSchema.index({ resource: 1, startTime: 1, endTime: 1 });

/**
 * Checks whether this booking overlaps with any CONFIRMED booking for the same resource.
 * @returns {boolean} true if a conflict exists
 */
bookingSchema.methods.checkConflict = async function () {
  const Booking = mongoose.model('Booking');
  const conflict = await Booking.findOne({
    _id: { $ne: this._id },
    resource: this.resource,
    status: { $in: ['CONFIRMED', 'PENDING'] },
    $or: [
      { startTime: { $lt: this.endTime, $gte: this.startTime } },
      { endTime: { $gt: this.startTime, $lte: this.endTime } },
      { startTime: { $lte: this.startTime }, endTime: { $gte: this.endTime } },
    ],
  });
  return !!conflict;
};

/**
 * Confirms this booking (sets status to CONFIRMED) and saves.
 */
bookingSchema.methods.confirm = async function () {
  this.status = 'CONFIRMED';
  return this.save();
};

/**
 * Cancels this booking (sets status to CANCELLED) and saves.
 */
bookingSchema.methods.cancel = async function () {
  this.status = 'CANCELLED';
  return this.save();
};

module.exports = mongoose.model('Booking', bookingSchema);
