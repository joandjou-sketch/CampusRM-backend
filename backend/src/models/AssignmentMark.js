'use strict';

const mongoose = require('mongoose');

/**
 * AssignmentMark schema — per-student mark for an Assignment.
 */
const assignmentMarkSchema = new mongoose.Schema(
  {
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      required: [true, 'Assignment is required'],
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student is required'],
    },
    marks: {
      type: Number,
      required: [true, 'Marks is required'],
      min: 0,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** One mark per student per assignment (re-recording updates the existing row) */
assignmentMarkSchema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('AssignmentMark', assignmentMarkSchema);
