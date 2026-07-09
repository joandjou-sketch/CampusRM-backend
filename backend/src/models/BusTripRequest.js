'use strict';

const mongoose = require('mongoose');

const busTripRequestSchema = new mongoose.Schema(
  {
    requester:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    requesterName:          { type: String, required: true },
    requesterEmail:         { type: String, required: true },
    route:                  { type: mongoose.Schema.Types.ObjectId, ref: 'Route' },
    origin:                 { type: String, required: true, default: 'Main Campus' },
    destination:            { type: String, required: true },
    preferredDate:          { type: Date, required: true },
    preferredDepartureTime: { type: String, required: true },
    numberOfPassengers:     { type: Number, required: true, min: 1 },
    purpose:                { type: String, required: true },
    notes:                  { type: String },
    status:                 { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    rejectionReason:        { type: String },
    reviewedAt:             { type: Date },
    reviewedBy:             { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BusTripRequest', busTripRequestSchema);
