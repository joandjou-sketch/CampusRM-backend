'use strict';

/**
 * Sample-data seed script for CampusRM.
 *
 * Populates library books, labs/rooms, equipment, bus routes/trips/fleet — plus
 * a thin layer of realistic bookings/loans/reservations so dashboards aren't empty —
 * reusing existing users wherever a suitable role already exists in the database.
 * New users are only created to fill roles/counts the existing roster is missing
 * (e.g. there was no LAB_MANAGER or EQUIPMENT_MANAGER account yet, and only one
 * STUDENT account, which is BLOCKED).
 *
 * Safe to re-run: every insert is guarded by a "does this already exist?" check
 * (findOrCreate) keyed on a natural unique field (email, book ISBN, resource
 * name, route name, etc.), so existing data is never duplicated or overwritten.
 *
 * Usage:
 *   node seed.js
 *
 * Reads MONGO_URI from .env (same connection the server uses).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const User = require('./src/models/User');
const Resource = require('./src/models/Resource');
const Booking = require('./src/models/Booking');
const Route = require('./src/models/Route');
const BusSeatBooking = require('./src/models/BusSeatBooking');
const LibraryTransaction = require('./src/models/LibraryTransaction');

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const summary = {}; // { 'Users': { created: 0, existing: 0 }, ... }
const newCredentials = []; // [{ email, password, role }] — new users only

function track(label, created) {
  summary[label] = summary[label] || { created: 0, existing: 0 };
  if (created) summary[label].created += 1;
  else summary[label].existing += 1;
}

/** Finds a document by `filter`; creates it with `filter + data` if missing. Never mutates an existing doc. */
async function findOrCreate(Model, filter, data, label) {
  const existing = await Model.findOne(filter);
  if (existing) {
    track(label, false);
    return { doc: existing, created: false };
  }
  const doc = await Model.create({ ...filter, ...data });
  track(label, true);
  return { doc, created: true };
}

function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set) => set[crypto.randomInt(set.length)];

  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const rest = Array.from({ length: 8 }, () => pick(all));
  const chars = [...required, ...rest];

  // Fisher-Yates shuffle so the required characters aren't always in the same position
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Creates a user if `email` doesn't already exist, generating + hashing a password. */
async function findOrCreateUser({ fullName, email, role, department }) {
  const existing = await User.findOne({ email });
  if (existing) {
    track('Users', false);
    return existing;
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await User.create({
    fullName,
    email,
    passwordHash,
    role,
    department,
    status: 'ACTIVE',
    isActive: true,
  });

  track('Users', true);
  newCredentials.push({ email, password, role });
  return user;
}

function daysFromNow(days, hour = 0, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.\n');

  /* ── 1. Users — reuse existing roles, fill in what's missing ─────────────── */

  const libraryManager = await User.findOne({ role: 'LIBRARIAN', status: 'ACTIVE' });
  const busManager = await User.findOne({ role: 'BUS_MANAGER', status: 'ACTIVE' });

  const labManager = await findOrCreateUser({
    fullName: 'Samuel Etoundi',
    email: 'samuel.etoundi@campus.edu',
    role: 'LAB_MANAGER',
    department: 'Facilities & Labs',
  });

  const equipmentManager = await findOrCreateUser({
    fullName: 'Brenda Fokou',
    email: 'brenda.fokou@campus.edu',
    role: 'EQUIPMENT_MANAGER',
    department: 'Facilities & Equipment',
  });

  await findOrCreateUser({
    fullName: 'Grace Mballa',
    email: 'grace.mballa@campus.edu',
    role: 'FACULTY',
    department: 'Computer Engineering',
  });

  const studentSeeds = [
    { fullName: 'Aisha Tchamba', email: 'aisha.tchamba@campus.edu', department: 'Computer Engineering' },
    { fullName: 'Kevin Nguemo', email: 'kevin.nguemo@campus.edu', department: 'Electrical Engineering' },
    { fullName: 'Linda Asong', email: 'linda.asong@campus.edu', department: 'Civil Engineering' },
    { fullName: 'Marc Eposi', email: 'marc.eposi@campus.edu', department: 'Computer Engineering' },
    { fullName: 'Sandra Bawak', email: 'sandra.bawak@campus.edu', department: 'Business Informatics' },
  ];
  const students = [];
  for (const s of studentSeeds) {
    students.push(await findOrCreateUser({ ...s, role: 'STUDENT' }));
  }

  /* ── 2. Library books ─────────────────────────────────────────────────────── */

  const bookSeeds = [
    { title: 'Introduction to Algorithms', author: 'Thomas H. Cormen', isbn: '9780262033848', category: 'Computer Science', totalCopies: 4 },
    { title: 'Database System Concepts', author: 'Abraham Silberschatz', isbn: '9780078022159', category: 'Computer Science', totalCopies: 3 },
    { title: 'Computer Networking: A Top-Down Approach', author: 'James Kurose', isbn: '9780133594140', category: 'Networking', totalCopies: 3 },
    { title: 'Clean Code', author: 'Robert C. Martin', isbn: '9780132350884', category: 'Software Engineering', totalCopies: 5 },
    { title: 'Operating System Concepts', author: 'Abraham Silberschatz', isbn: '9781118063330', category: 'Computer Science', totalCopies: 2 },
    { title: 'Digital Design and Computer Architecture', author: 'David Harris', isbn: '9780123944245', category: 'Electronics', totalCopies: 2 },
    { title: 'Engineering Mechanics: Statics', author: 'Russell C. Hibbeler', isbn: '9780133918922', category: 'Civil Engineering', totalCopies: 3 },
    { title: 'Principles of Electric Circuits', author: 'Thomas L. Floyd', isbn: '9780132622646', category: 'Electrical Engineering', totalCopies: 2 },
    { title: 'A Guide to the Project Management Body of Knowledge', author: 'PMI', isbn: '9781628251845', category: 'Management', totalCopies: 2 },
    { title: 'Discrete Mathematics and Its Applications', author: 'Kenneth Rosen', isbn: '9780073383095', category: 'Mathematics', totalCopies: 4 },
  ];

  const books = [];
  for (const b of bookSeeds) {
    const { doc } = await findOrCreate(
      Resource,
      { type: 'OTHER', 'metadata.isbn': b.isbn },
      {
        name: b.title,
        location: 'Main Library',
        description: `${b.category} reference text.`,
        status: 'AVAILABLE',
        totalCopies: b.totalCopies,
        availableCopies: b.totalCopies,
        tags: [b.category, b.author, b.isbn],
        metadata: { author: b.author, isbn: b.isbn, category: b.category },
      },
      'Library books'
    );
    books.push(doc);
  }

  /* ── 3. Labs & rooms ───────────────────────────────────────────────────────── */

  const labSeeds = [
    { name: 'Computer Lab A', location: 'Block C, Ground Floor', capacity: 40, description: 'General-purpose computing lab.' },
    { name: 'Computer Lab B', location: 'Block C, First Floor', capacity: 35, description: 'Networking & systems lab.' },
    { name: 'Electronics & Embedded Systems Lab', location: 'Block D, First Floor', capacity: 25, description: 'Embedded systems and circuits bench.' },
    { name: 'Physics Laboratory', location: 'Block A, Ground Floor', capacity: 30, description: 'General physics practicals.' },
    { name: 'Conference Room 101', location: 'Admin Block', capacity: 15, description: 'Meeting and seminar room.' },
  ];

  const labs = [];
  for (const l of labSeeds) {
    const { doc } = await findOrCreate(
      Resource,
      { type: 'LAB', name: l.name },
      {
        location: l.location,
        capacity: l.capacity,
        description: l.description,
        status: 'AVAILABLE',
        managedBy: labManager._id,
      },
      'Labs & rooms'
    );
    labs.push(doc);
  }

  /* ── 4. Equipment ──────────────────────────────────────────────────────────── */

  const equipmentSeeds = [
    { name: 'Dell Latitude 5430 Laptop #1', category: 'Laptop', location: 'IT Equipment Store' },
    { name: 'Dell Latitude 5430 Laptop #2', category: 'Laptop', location: 'IT Equipment Store' },
    { name: 'HP ProBook Laptop #1', category: 'Laptop', location: 'IT Equipment Store' },
    { name: 'Epson EB-X06 Projector #1', category: 'Projector', location: 'AV Equipment Store' },
    { name: 'Epson EB-X06 Projector #2', category: 'Projector', location: 'AV Equipment Store' },
    { name: 'Digital Multimeter Set', category: 'Lab Instrument', location: 'Electronics Lab Store' },
    { name: 'Arduino Starter Kit Bundle', category: 'Lab Instrument', location: 'Electronics Lab Store' },
    { name: 'Canon EOS DSLR Camera', category: 'AV Equipment', location: 'AV Equipment Store' },
  ];

  const equipment = [];
  for (const e of equipmentSeeds) {
    const { doc } = await findOrCreate(
      Resource,
      { type: 'EQUIPMENT', name: e.name },
      {
        location: e.location,
        description: `${e.category} available for short-term checkout.`,
        status: 'AVAILABLE',
        tags: [e.category],
        metadata: { category: e.category },
        managedBy: equipmentManager._id,
      },
      'Equipment'
    );
    equipment.push(doc);
  }

  /* ── 5. Bus fleet, routes & trips ─────────────────────────────────────────── */

  const busSeeds = [
    { name: 'IUC Bus 01', capacity: 50, location: 'Main Campus Garage' },
    { name: 'IUC Bus 02', capacity: 30, location: 'Main Campus Garage' },
  ];
  const buses = [];
  for (const b of busSeeds) {
    const { doc } = await findOrCreate(
      Resource,
      { type: 'BUS', name: b.name },
      { capacity: b.capacity, location: b.location, status: 'AVAILABLE', managedBy: busManager?._id },
      'Buses'
    );
    buses.push(doc);
  }

  const routeSeeds = [
    { name: 'Campus – Bonamoussadi', origin: 'Main Campus', destination: 'Bonamoussadi', stops: ['Carrefour Logbessou', 'Bonamoussadi Total'], schedule: ['07:00', '12:00', '17:00'] },
    { name: 'Campus – Akwa', origin: 'Main Campus', destination: 'Akwa', stops: ['Bessengue', 'Akwa Nord'], schedule: ['07:30', '13:00', '18:00'] },
    { name: 'Campus – Bonaberi', origin: 'Main Campus', destination: 'Bonaberi', stops: ['Pont du Wouri', 'Bonaberi Marché'], schedule: ['08:00', '14:00'] },
  ];
  const routes = [];
  for (const r of routeSeeds) {
    const { doc } = await findOrCreate(
      Route,
      { name: r.name },
      { origin: r.origin, destination: r.destination, stops: r.stops, schedule: r.schedule, isActive: true },
      'Bus routes'
    );
    routes.push(doc);
  }

  // A handful of upcoming trips spread across the next few days, alternating bus/route.
  const tripPlan = [
    { dayOffset: 1, hour: 7,  busIdx: 0, routeIdx: 0 },
    { dayOffset: 1, hour: 13, busIdx: 1, routeIdx: 1 },
    { dayOffset: 2, hour: 7,  busIdx: 0, routeIdx: 1 },
    { dayOffset: 2, hour: 14, busIdx: 1, routeIdx: 2 },
    { dayOffset: 3, hour: 8,  busIdx: 0, routeIdx: 2 },
    { dayOffset: 4, hour: 7,  busIdx: 1, routeIdx: 0 },
  ];
  const trips = [];
  for (const t of tripPlan) {
    const bus = buses[t.busIdx];
    const route = routes[t.routeIdx];
    const startTime = daysFromNow(t.dayOffset, t.hour, 0);
    const endTime = daysFromNow(t.dayOffset, t.hour + 1, 0);

    const { doc } = await findOrCreate(
      Booking,
      { resource: bus._id, route: route._id },
      {
        createdBy: busManager?._id,
        startTime,
        endTime,
        status: 'CONFIRMED',
        approvedBy: busManager?._id,
        purpose: `Scheduled trip on route ${route.name}`,
      },
      'Bus trips'
    );

    trips.push(doc);
  }

  // A couple of seat reservations by students on the first two trips.
  if (trips.length >= 2 && students.length >= 2) {
    const reservationPlan = [
      { trip: trips[0], user: students[0], seatNo: 1 },
      { trip: trips[0], user: students[1], seatNo: 2 },
      { trip: trips[1], user: students[2], seatNo: 1 },
    ];
    for (const r of reservationPlan) {
      await findOrCreate(
        BusSeatBooking,
        { trip: r.trip._id, user: r.user._id },
        { route: r.trip.route, seatNo: r.seatNo, status: 'CONFIRMED' },
        'Bus seat reservations'
      );
    }
  }

  /* ── 6. A thin layer of realistic activity (so dashboards aren't empty) ──── */

  // Library: a few active borrows, one deliberately overdue.
  if (students.length >= 3 && books.length >= 3) {
    const loanPlan = [
      { user: students[0], book: books[0], dueInDays: 10 },
      { user: students[1], book: books[1], dueInDays: 5 },
      { user: students[2], book: books[2], dueInDays: -3 }, // overdue on purpose
    ];
    for (const loan of loanPlan) {
      const { created } = await findOrCreate(
        LibraryTransaction,
        { user: loan.user._id, book: loan.book._id, status: { $in: ['ACTIVE', 'OVERDUE'] } },
        {
          dueDate: daysFromNow(loan.dueInDays),
          status: loan.dueInDays < 0 ? 'OVERDUE' : 'ACTIVE',
        },
        'Library loans'
      );
      if (created) {
        loan.book.availableCopies = Math.max(0, (loan.book.availableCopies || 1) - 1);
        await loan.book.save();
      }
    }
  }

  // Labs: a couple of pending/confirmed bookings by students.
  if (students.length >= 2 && labs.length >= 2) {
    const labBookingPlan = [
      { user: students[0], lab: labs[0], dayOffset: 2, hour: 9, status: 'CONFIRMED', purpose: 'Database systems practical session' },
      { user: students[1], lab: labs[1], dayOffset: 3, hour: 14, status: 'PENDING', purpose: 'Group project work' },
    ];
    for (const b of labBookingPlan) {
      const startTime = daysFromNow(b.dayOffset, b.hour, 0);
      const endTime = daysFromNow(b.dayOffset, b.hour + 2, 0);
      // Matched on resource+requester alone (each pair is unique in labBookingPlan) —
      // not on startTime, so re-running on a later date doesn't create a duplicate.
      await findOrCreate(
        Booking,
        { resource: b.lab._id, createdBy: b.user._id },
        { startTime, endTime, status: b.status, purpose: b.purpose },
        'Lab bookings'
      );
    }
  }

  // Equipment: a couple of checkout requests by students.
  if (students.length >= 2 && equipment.length >= 2) {
    const equipmentBookingPlan = [
      { user: students[3], item: equipment[0], dayOffset: 1, hour: 10, status: 'PENDING', purpose: 'Final-year project demo' },
      { user: students[4], item: equipment[3], dayOffset: 2, hour: 9, status: 'CONFIRMED', purpose: 'Departmental seminar' },
    ];
    for (const b of equipmentBookingPlan) {
      const startTime = daysFromNow(b.dayOffset, b.hour, 0);
      const endTime = daysFromNow(b.dayOffset, b.hour + 3, 0);
      // Matched on resource+requester alone (each pair is unique in equipmentBookingPlan) —
      // not on startTime, so re-running on a later date doesn't create a duplicate.
      await findOrCreate(
        Booking,
        { resource: b.item._id, createdBy: b.user._id },
        { startTime, endTime, status: b.status, purpose: b.purpose },
        'Equipment bookings'
      );
    }
  }

  await mongoose.disconnect();

  /* ── 7. Report ─────────────────────────────────────────────────────────────── */

  console.log('── Seed summary ─────────────────────────────────────────────');
  for (const [label, counts] of Object.entries(summary)) {
    console.log(`${label.padEnd(24)} created: ${counts.created}, already existed: ${counts.existing}`);
  }

  if (newCredentials.length > 0) {
    console.log('\n── NEW USER CREDENTIALS (shown only once — save them now) ───');
    for (const c of newCredentials) {
      console.log(`${c.email.padEnd(32)} ${c.password.padEnd(14)} (${c.role})`);
    }
  } else {
    console.log('\nNo new users were created — all required roles already existed.');
  }
  console.log('───────────────────────────────────────────────────────────────');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
