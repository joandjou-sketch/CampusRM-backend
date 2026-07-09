'use strict';

const mongoose = require('mongoose');

/**
 * User schema — single collection, role-based (discriminator-friendly).
 * _id serves as userId. Passwords are stored pre-hashed (bcrypt) via passwordHash.
 */
const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      enum: ['STUDENT', 'FACULTY', 'STAFF', 'ADMIN', 'LIBRARIAN', 'LAB_MANAGER', 'EQUIPMENT_MANAGER', 'BUS_MANAGER'],
      default: 'STUDENT',
    },
    /** New accounts start pending; an admin must approve before login is allowed. Mirrors `status`. */
    isActive: {
      type: Boolean,
      default: false,
    },
    /**
     * Lifecycle state, distinct from the `isActive` login gate so a manually-
     * or auto-blocked account can't be mistaken for a fresh pending signup.
     * PENDING: awaiting first approval. ACTIVE: approved, in good standing.
     * BLOCKED: approved once, then blocked (by an admin or auto-suspended for overdue items).
     */
    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'BLOCKED'],
      default: 'PENDING',
    },
    department: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    equipmentRestricted: {
      type: Boolean,
      default: false,
    },
    /**
     * Library-specific restriction, distinct from the account-wide `status`.
     * Lets a librarian revoke just library privileges (e.g. repeated late
     * returns) without blocking the user's access to labs, equipment, or bus.
     */
    libraryAccess: {
      type: String,
      enum: ['ACTIVE', 'BLOCKED'],
      default: 'ACTIVE',
    },
    libraryBlockReason: {
      type: String,
      trim: true,
    },
    /**
     * Equipment-specific restriction, distinct from `equipmentRestricted`
     * (which is auto-set for overdue items) — lets an equipment manager
     * manually revoke equipment privileges with a reason (e.g. damage,
     * repeated late returns) without touching the account's other access.
     */
    equipmentAccess: {
      type: String,
      enum: ['ACTIVE', 'BLOCKED'],
      default: 'ACTIVE',
    },
    equipmentAccessBlockReason: {
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

/** Virtual: expose _id as userId for clarity in responses */
userSchema.virtual('userId').get(function () {
  return this._id;
});

/** Remove passwordHash from JSON output */
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
