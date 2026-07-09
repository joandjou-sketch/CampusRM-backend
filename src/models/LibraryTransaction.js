'use strict';

const mongoose = require('mongoose');

/**
 * LibraryTransaction schema — tracks book borrowing and returns.
 * Links User + Resource (book) + checkout/return dates.
 */
const libraryTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
    },
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: [true, 'Book is required'],
    },
    checkoutDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    returnDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'RETURN_PENDING', 'RETURNED', 'OVERDUE'],
      default: 'ACTIVE',
    },
    /** Set when the borrower marks the book as returned, pending librarian confirmation. */
    returnRequestedAt: {
      type: Date,
    },
    conditionAtCheckout: {
      type: String,
      trim: true,
    },
    conditionAtReturn: {
      type: String,
      trim: true,
    },
    processedBy: {
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

libraryTransactionSchema.index({ user: 1, book: 1, status: 1 });

libraryTransactionSchema.methods.isOverdue = function () {
  if (this.status === 'RETURNED') return false;
  return new Date() > this.dueDate;
};

libraryTransactionSchema.methods.calculateOverdueCount = async function () {
  const count = await this.constructor.countDocuments({
    user: this.user,
    status: 'ACTIVE',
    dueDate: { $lt: new Date() },
  });
  return count;
};

module.exports = mongoose.model('LibraryTransaction', libraryTransactionSchema);