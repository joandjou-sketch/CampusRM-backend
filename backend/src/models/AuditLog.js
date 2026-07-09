'use strict';

const mongoose = require('mongoose');

/**
 * AuditLog schema — APPEND-ONLY immutable log of every significant action.
 * No update or delete routes should ever target this collection.
 */
const auditLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    action: {
      type: String,
      required: [true, 'Action is required'],
      trim: true,
    },
    entityType: {
      type: String,
      required: [true, 'Entity type is required'],
      trim: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: false,
    /* Prevent any update or replace operations at the schema level */
  }
);

/** Immutability guard — block any attempt to update or delete audit entries */
auditLogSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function () {
  throw new Error('AuditLog is immutable — updates are not permitted');
});

auditLogSchema.pre(['deleteOne', 'findOneAndDelete', 'deleteMany'], function () {
  throw new Error('AuditLog is immutable — deletes are not permitted');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
