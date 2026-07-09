'use strict';

const mongoose = require('mongoose');

/**
 * Attendance schema — one row per student per ClassLog session.
 */
const attendanceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student is required'],
    },
    classLog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassLog',
      required: [true, 'Class log is required'],
    },
    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT', 'LATE'],
      required: [true, 'Status is required'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** One attendance row per student per session */
attendanceSchema.index({ classLog: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
