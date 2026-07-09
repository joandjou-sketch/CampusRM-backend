'use strict';

const mongoose = require('mongoose');

/**
 * TripLog schema — one per executed bus trip (BUS-03). Captures odometer
 * readings used to derive km travelled for the utilisation dashboard (BUS-05).
 */
const tripLogSchema = new mongoose.Schema(
  {
    trip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Trip is required'],
    },
    bus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: [true, 'Bus is required'],
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
      required: [true, 'Route is required'],
    },
    odometerStart: {
      type: Number,
      required: [true, 'Odometer start reading is required'],
      min: 0,
    },
    odometerEnd: {
      type: Number,
      min: 0,
    },
    purpose: {
      type: String,
      trim: true,
    },
    departedAt: {
      type: Date,
    },
    returnedAt: {
      type: Date,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recorder is required'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Returns the km travelled, or null if the return odometer reading is not yet recorded.
 */
tripLogSchema.methods.kmTravelled = function () {
  if (this.odometerEnd == null) return null;
  return Math.max(0, this.odometerEnd - this.odometerStart);
};

module.exports = mongoose.model('TripLog', tripLogSchema);
