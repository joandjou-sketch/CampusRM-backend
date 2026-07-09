'use strict';

const mongoose = require('mongoose');

const VALID_ROLES = ['STUDENT', 'FACULTY', 'STAFF', 'LIBRARIAN', 'LAB_MANAGER', 'EQUIPMENT_MANAGER', 'BUS_MANAGER'];

/**
 * InstitutionalRegistry — source of truth for who is authorised to register.
 * Registration requires a matching schoolId; role, name, email and department
 * are drawn from this collection so users cannot self-assign a role.
 */
const institutionalRegistrySchema = new mongoose.Schema(
  {
    schoolId: {
      type: String,
      required: [true, 'School ID is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: VALID_ROLES,
    },
    department: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('InstitutionalRegistry', institutionalRegistrySchema);
