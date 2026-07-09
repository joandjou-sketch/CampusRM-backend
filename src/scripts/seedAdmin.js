'use strict';

/**
 * Creates (or re-activates) the first ADMIN account.
 *
 * Self-registration can never produce an ADMIN account, and every
 * self-registered account starts pending until an admin approves it —
 * so the very first admin has to be provisioned out-of-band, by whoever
 * controls the database/server. Run this script to do that.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@campus.edu ADMIN_PASSWORD=ChangeMe123! ADMIN_NAME="System Admin" npm run seed:admin
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME || 'System Administrator';

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running this script.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await User.findOneAndUpdate(
    { email },
    { fullName, email, passwordHash, role: 'ADMIN', isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Admin account ready: ${admin.email} (${admin._id})`);
  await mongoose.disconnect();
}

seedAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
