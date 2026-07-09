'use strict';

const mongoose = require('mongoose');

/**
 * InternalMark schema — one row per student per Subject per assessment component.
 * Aggregated into a total internal mark per Subject (UC-50/UC-51).
 */
const internalMarkSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student is required'],
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: [true, 'Subject is required'],
    },
    component: {
      type: String,
      enum: ['QUIZ', 'MIDTERM', 'CA'],
      required: [true, 'Component is required'],
    },
    marks: {
      type: Number,
      required: [true, 'Marks is required'],
      min: 0,
    },
    maxMarks: {
      type: Number,
      required: [true, 'Max marks is required'],
      min: 0,
    },
    recordedBy: {
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

/** One mark per student per subject per component (re-recording updates the existing row) */
internalMarkSchema.index({ student: 1, subject: 1, component: 1 }, { unique: true });

module.exports = mongoose.model('InternalMark', internalMarkSchema);
