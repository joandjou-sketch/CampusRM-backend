'use strict';

const mongoose = require('mongoose');

/**
 * Checkout schema — tracks the physical handover and return of a Resource.
 * Linked to a Booking (optional for walk-in checkouts) and a Resource.
 */
const checkoutSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
    },
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: [true, 'Resource is required'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User (borrower) is required'],
    },
    checkedOutBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    checkoutTime: {
      type: Date,
      default: Date.now,
    },
    dueTime: {
      type: Date,
      required: [true, 'Due time is required'],
    },
    returnTime: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'RETURN_PENDING', 'RETURNED', 'OVERDUE', 'LOST'],
      default: 'ACTIVE',
    },
    /** Set when the borrower marks the item as returned, pending manager confirmation. */
    returnRequestedAt: {
      type: Date,
    },
    condition: {
      atCheckout: { type: String, trim: true },
      atReturn: { type: String, trim: true },
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

/**
 * Records the return of the resource and marks the checkout as RETURNED.
 * @param {string} conditionAtReturn - Optional condition description at return
 */
checkoutSchema.methods.returnResource = async function (conditionAtReturn) {
  this.returnTime = new Date();
  this.status = 'RETURNED';
  if (conditionAtReturn) this.condition.atReturn = conditionAtReturn;
  return this.save();
};

/**
 * Alias for returnResource — marks this checkout as returned.
 */
checkoutSchema.methods.markReturned = async function () {
  return this.returnResource();
};

/**
 * Returns true if the resource has not been returned past the due time.
 * @returns {boolean}
 */
checkoutSchema.methods.isOverdue = function () {
  if (this.status === 'RETURNED') return false;
  return new Date() > this.dueTime;
};

module.exports = mongoose.model('Checkout', checkoutSchema);
