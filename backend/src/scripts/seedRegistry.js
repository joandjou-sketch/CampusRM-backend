'use strict';

/**
 * Seeds the InstitutionalRegistry collection with the 25 pre-approved
 * institutional members. Run once:  node src/scripts/seedRegistry.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const InstitutionalRegistry = require('../models/InstitutionalRegistry');

const ENTRIES = [
  // ── STUDENTS (15) ────────────────────────────────────────────────────────
  { schoolId: 'STU2024001', name: 'Alice Johnson',      email: 'alice.johnson@campus.edu',     role: 'STUDENT',           department: 'Computer Science' },
  { schoolId: 'STU2024002', name: 'Bob Martinez',       email: 'bob.martinez@campus.edu',      role: 'STUDENT',           department: 'Engineering' },
  { schoolId: 'STU2024003', name: 'Carol Williams',     email: 'carol.williams@campus.edu',    role: 'STUDENT',           department: 'Mathematics' },
  { schoolId: 'STU2024004', name: 'David Brown',        email: 'david.brown@campus.edu',       role: 'STUDENT',           department: 'Physics' },
  { schoolId: 'STU2024005', name: 'Emma Davis',         email: 'emma.davis@campus.edu',        role: 'STUDENT',           department: 'Chemistry' },
  { schoolId: 'STU2024006', name: 'Frank Wilson',       email: 'frank.wilson@campus.edu',      role: 'STUDENT',           department: 'Biology' },
  { schoolId: 'STU2024007', name: 'Grace Moore',        email: 'grace.moore@campus.edu',       role: 'STUDENT',           department: 'Literature' },
  { schoolId: 'STU2024008', name: 'Henry Taylor',       email: 'henry.taylor@campus.edu',      role: 'STUDENT',           department: 'History' },
  { schoolId: 'STU2024009', name: 'Isabella Anderson',  email: 'isabella.anderson@campus.edu', role: 'STUDENT',           department: 'Psychology' },
  { schoolId: 'STU2024010', name: 'James Thomas',       email: 'james.thomas@campus.edu',      role: 'STUDENT',           department: 'Economics' },
  { schoolId: 'STU2024011', name: 'Katherine Jackson',  email: 'katherine.jackson@campus.edu', role: 'STUDENT',           department: 'Sociology' },
  { schoolId: 'STU2024012', name: 'Liam White',         email: 'liam.white@campus.edu',        role: 'STUDENT',           department: 'Philosophy' },
  { schoolId: 'STU2024013', name: 'Mia Harris',         email: 'mia.harris@campus.edu',        role: 'STUDENT',           department: 'Fine Arts' },
  { schoolId: 'STU2024014', name: 'Noah Clark',         email: 'noah.clark@campus.edu',        role: 'STUDENT',           department: 'Music' },
  { schoolId: 'STU2024015', name: 'Olivia Lewis',       email: 'olivia.lewis@campus.edu',      role: 'STUDENT',           department: 'Business Administration' },

  // ── MANAGERS ─────────────────────────────────────────────────────────────
  { schoolId: 'MGR2024BUS', name: 'Patrick Robinson',   email: 'patrick.robinson@campus.edu',  role: 'BUS_MANAGER',       department: 'Transport Services' },
  { schoolId: 'MGR2024LAB', name: 'Quinn Walker',       email: 'quinn.walker@campus.edu',      role: 'LAB_MANAGER',       department: 'Laboratory Services' },
  { schoolId: 'MGR2024EQP', name: 'Rachel Hall',        email: 'rachel.hall@campus.edu',       role: 'EQUIPMENT_MANAGER', department: 'Equipment Services' },

  // ── LIBRARIAN ─────────────────────────────────────────────────────────────
  { schoolId: 'LIB2024001', name: 'Samuel Allen',       email: 'samuel.allen@campus.edu',      role: 'LIBRARIAN',         department: 'Library Services' },

  // ── STAFF (3) ─────────────────────────────────────────────────────────────
  { schoolId: 'STF2024001', name: 'Teresa Young',       email: 'teresa.young@campus.edu',      role: 'STAFF',             department: 'Administration' },
  { schoolId: 'STF2024002', name: 'Ulysses Hernandez',  email: 'ulysses.hernandez@campus.edu', role: 'STAFF',             department: 'Finance' },
  { schoolId: 'STF2024003', name: 'Victoria King',      email: 'victoria.king@campus.edu',     role: 'STAFF',             department: 'Human Resources' },

  // ── FACULTY (3) ───────────────────────────────────────────────────────────
  { schoolId: 'FAC2024001', name: 'William Scott',      email: 'william.scott@campus.edu',     role: 'FACULTY',           department: 'Computer Science' },
  { schoolId: 'FAC2024002', name: 'Xena Green',         email: 'xena.green@campus.edu',        role: 'FACULTY',           department: 'Engineering' },
  { schoolId: 'FAC2024003', name: 'Yolanda Adams',      email: 'yolanda.adams@campus.edu',     role: 'FACULTY',           department: 'Mathematics' },

  // ── Accounts created by seed.js (sample resource data) ──────────────────
  { schoolId: 'MGR2024LAB02', name: 'Samuel Etoundi',   email: 'samuel.etoundi@campus.edu',    role: 'LAB_MANAGER',       department: 'Facilities & Labs' },
  { schoolId: 'MGR2024EQP02', name: 'Brenda Fokou',     email: 'brenda.fokou@campus.edu',      role: 'EQUIPMENT_MANAGER', department: 'Facilities & Equipment' },
  { schoolId: 'FAC2024004',   name: 'Grace Mballa',     email: 'grace.mballa@campus.edu',      role: 'FACULTY',           department: 'Computer Engineering' },
  { schoolId: 'STU2024016',   name: 'Aisha Tchamba',    email: 'aisha.tchamba@campus.edu',     role: 'STUDENT',           department: 'Computer Engineering' },
  { schoolId: 'STU2024017',   name: 'Kevin Nguemo',     email: 'kevin.nguemo@campus.edu',      role: 'STUDENT',           department: 'Electrical Engineering' },
  { schoolId: 'STU2024018',   name: 'Linda Asong',      email: 'linda.asong@campus.edu',       role: 'STUDENT',           department: 'Civil Engineering' },
  { schoolId: 'STU2024019',   name: 'Marc Eposi',       email: 'marc.eposi@campus.edu',        role: 'STUDENT',           department: 'Computer Engineering' },
  { schoolId: 'STU2024020',   name: 'Sandra Bawak',     email: 'sandra.bawak@campus.edu',      role: 'STUDENT',           department: 'Business Informatics' },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  let created = 0;
  let skipped = 0;

  for (const entry of ENTRIES) {
    const exists = await InstitutionalRegistry.findOne({ schoolId: entry.schoolId });
    if (exists) {
      console.log(`  SKIP  ${entry.schoolId} — already exists`);
      skipped++;
    } else {
      await InstitutionalRegistry.create(entry);
      console.log(`  OK    ${entry.schoolId} — ${entry.name} (${entry.role})`);
      created++;
    }
  }

  console.log(`\nDone. Created: ${created}  Skipped: ${skipped}`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
