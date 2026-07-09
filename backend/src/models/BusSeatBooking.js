'use strict';

const mongoose = require('mongoose');

/**
 * BusSeatBooking schema — a passenger's seat reservation on a scheduled bus
 * trip (a Booking document with resource.type === 'BUS'). Many seat bookings
 * can share the same trip, up to the bus's capacity.
 */
const busSeatBookingSchema = new mongoose.Schema(
  {
    trip: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Trip is required'],
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
      required: [true, 'Route is required'],
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    seatNo: {
      type: Number,
      min: 1,
    },
    status: {
      type: String,
      enum: ['CONFIRMED', 'CANCELLED', 'COMPLETED'],
      default: 'CONFIRMED',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

busSeatBookingSchema.index({ trip: 1, status: 1 });
busSeatBookingSchema.index({ user: 1 });

module.exports = mongoose.model('BusSeatBooking', busSeatBookingSchema);
