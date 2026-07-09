'use strict';

const mongoose = require('mongoose');

/**
 * Route schema — a bus route with stops and a recurring departure schedule.
 * Has many Bookings (trips) and BusSeatBookings.
 */
const routeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Route name is required'],
      trim: true,
    },
    origin: {
      type: String,
      required: [true, 'Origin is required'],
      trim: true,
    },
    destination: {
      type: String,
      required: [true, 'Destination is required'],
      trim: true,
    },
    stops: [{ type: String, trim: true }],
    schedule: [{ type: String, trim: true }],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Route', routeSchema);
