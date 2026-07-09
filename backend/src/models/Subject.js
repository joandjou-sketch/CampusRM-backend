'use strict';

const mongoose = require('mongoose');

/**
 * Subject (Course) schema — taught by one Faculty member, enrolled by many Students.
 * totalPlannedSessions backs the AL-01 "topics covered vs. planned" progress calculation.
 */
const subjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Subject name is required'],
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
    },
    faculty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Faculty is required'],
    },
    level: {
      type: String,
      trim: true,
    },
    program: {
      type: String,
      trim: true,
    },
    totalPlannedSessions: {
      type: Number,
      min: 0,
      default: 0,
    },
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

module.exports = mongoose.model('Subject', subjectSchema);
