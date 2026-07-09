'use strict';

const mongoose = require('mongoose');

/**
 * ClassLog schema — digitised class-logbook entry for one teaching session.
 * Belongs to a Subject + Faculty; has many Attendance rows.
 */
const classLogSchema = new mongoose.Schema(
  {
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: [true, 'Subject is required'],
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Faculty is required'],
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
    },
    period: {
      type: String,
      required: [true, 'Period is required'],
      trim: true,
    },
    topic: {
      type: String,
      required: [true, 'Topic is required'],
      trim: true,
    },
    lessonConducted: {
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

/** One log per subject + date + period — backs the UC-47 duplicate-session guard */
classLogSchema.index({ subject: 1, date: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('ClassLog', classLogSchema);
