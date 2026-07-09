'use strict';

/**
 * End-to-end smoke test for the Labs (Prompt 4) and Equipment (Prompt 5) modules.
 * Run the server first (`npm run dev`), then in another terminal:
 *   node scripts/labs-equipment-smoke-test.js
 *
 * Seeds a LAB and two EQUIPMENT resources directly via Mongoose, exercises
 * every implemented route + RBAC + key edge cases, then cleans up.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const BASE = `http://localhost:${process.env.PORT || 5000}/api/v1`;
const RUN = Date.now();

let passed = 0;
let failed = 0;

function check(name, condition, info) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`, info !== undefined ? JSON.stringify(info) : '');
  }
}

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const emails = {
  manager: `smoke.manager.${RUN}@test.com`,
  student1: `smoke.student1.${RUN}@test.com`,
  student2: `smoke.student2.${RUN}@test.com`,
};
const PASSWORD = 'password123';
const tokens = {};
const userIds = {};

let labId;
let equipmentId;
let equipment2Id;

let labBookingId;
let equipmentBookingId;
let checkoutId;
let maintenanceId;

function hours(n) {
  return n * 60 * 60 * 1000;
}

async function setup() {
  console.log('\n=== Setup (seed resources + users) ===');
  await mongoose.connect(process.env.MONGO_URI);

  const Resource = require('../src/models/Resource');

  const lab = await Resource.create({
    name: `SmokeTest Lab ${RUN}`,
    type: 'LAB',
    location: 'Building A - Room 101',
    capacity: 30,
    status: 'AVAILABLE',
  });
  labId = lab._id.toString();
  check('Seeded LAB resource', !!labId);

  const equipment = await Resource.create({
    name: `SmokeTest Projector ${RUN}`,
    type: 'EQUIPMENT',
    location: 'IT Store Room',
    status: 'AVAILABLE',
  });
  equipmentId = equipment._id.toString();
  check('Seeded EQUIPMENT resource', !!equipmentId);

  const equipment2 = await Resource.create({
    name: `SmokeTest Laptop ${RUN}`,
    type: 'EQUIPMENT',
    location: 'IT Store Room',
    status: 'AVAILABLE',
  });
  equipment2Id = equipment2._id.toString();
  check('Seeded second EQUIPMENT resource', !!equipment2Id);

  for (const [role, email] of [
    ['LAB_MANAGER', emails.manager],
    ['STUDENT', emails.student1],
    ['STUDENT', emails.student2],
  ]) {
    const r = await api('POST', '/auth/register', {
      body: { fullName: `Smoke ${role} ${email}`, email, password: PASSWORD, role },
    });
    check(`POST /auth/register (${role}) -> 201`, r.status === 201, r.body);
  }

  for (const [key, email] of Object.entries(emails)) {
    const r = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
    check(`POST /auth/login (${key}) -> 200 with token`, r.status === 200 && !!r.body?.data?.token, r.body);
    tokens[key] = r.body?.data?.token;
    userIds[key] = r.body?.data?.user?.userId;
  }
}

/* ════════════════════════════ LABS (Prompt 4) ═══════════════════════════ */

async function testLabsSchedule() {
  console.log('\n=== Labs: inventory & schedule (GEN-06/UC-34) ===');

  const noToken = await api('GET', '/labs');
  check('GET /labs without token -> 401', noToken.status === 401, noToken.body);

  const list = await api('GET', '/labs', { token: tokens.student1 });
  check('GET /labs -> 200', list.status === 200, list.body);
  check('  includes seeded lab', list.body?.data?.some((l) => l._id === labId), list.body);

  const schedule = await api('GET', `/labs/${labId}/schedule`, { token: tokens.student1 });
  check('GET /labs/:id/schedule -> 200', schedule.status === 200 && schedule.body?.data?.lab?._id === labId, schedule.body);

  const badId = await api('GET', '/labs/not-an-id/schedule', { token: tokens.student1 });
  check('GET /labs/<bad-id>/schedule -> 400', badId.status === 400, badId.body);

  const notFound = await api('GET', '/labs/000000000000000000000000/schedule', { token: tokens.student1 });
  check('GET /labs/<nonexistent>/schedule -> 404', notFound.status === 404, notFound.body);
}

async function testLabsBookingFlow() {
  console.log('\n=== Labs: booking request, conflicts & approval (UC-35/36/37) ===');

  const start = new Date(Date.now() + hours(24));
  const end = new Date(Date.now() + hours(26));

  const missing = await api('POST', `/labs/${labId}/book`, { token: tokens.student1, body: {} });
  check('POST /labs/:id/book missing fields -> 400', missing.status === 400, missing.body);

  const create = await api('POST', `/labs/${labId}/book`, {
    token: tokens.student1,
    body: { startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Smoke test session' },
  });
  check('POST /labs/:id/book -> 201 PENDING', create.status === 201 && create.body?.data?.status === 'PENDING', create.body);
  labBookingId = create.body?.data?._id;

  const conflict = await api('POST', `/labs/${labId}/book`, {
    token: tokens.student2,
    body: { startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Overlapping session' },
  });
  check('POST /labs/:id/book overlapping window -> 409', conflict.status === 409, conflict.body);
  check('  409 includes suggestedAlternatives', Array.isArray(conflict.body?.data?.suggestedAlternatives), conflict.body);

  const myBookings = await api('GET', '/labs/bookings/me', { token: tokens.student1 });
  check('GET /labs/bookings/me -> includes booking', myBookings.status === 200 && myBookings.body?.data?.some((b) => b._id === labBookingId), myBookings.body);

  const approveAsStudent = await api('PUT', `/labs/bookings/${labBookingId}/approve`, { token: tokens.student1 });
  check('PUT /labs/bookings/:id/approve as STUDENT -> 403', approveAsStudent.status === 403, approveAsStudent.body);

  const rejectNoReason = await api('PUT', `/labs/bookings/${labBookingId}/reject`, { token: tokens.manager, body: {} });
  check('PUT /labs/bookings/:id/reject without reason -> 400', rejectNoReason.status === 400, rejectNoReason.body);

  const approve = await api('PUT', `/labs/bookings/${labBookingId}/approve`, { token: tokens.manager });
  check('PUT /labs/bookings/:id/approve as LAB_MANAGER -> 200 CONFIRMED', approve.status === 200 && approve.body?.data?.status === 'CONFIRMED', approve.body);
}

async function testLabsCancelAndUtilization() {
  console.log('\n=== Labs: cancellation (UC-38) & utilization report (UC-40) ===');

  const cancelByOther = await api('DELETE', `/labs/bookings/${labBookingId}`, { token: tokens.student2 });
  check('DELETE /labs/bookings/:id by non-owner non-admin -> 403', cancelByOther.status === 403, cancelByOther.body);

  const cancel = await api('DELETE', `/labs/bookings/${labBookingId}`, { token: tokens.student1 });
  check('DELETE /labs/bookings/:id by owner -> 200 CANCELLED', cancel.status === 200 && cancel.body?.data?.status === 'CANCELLED', cancel.body);

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + hours(24 * 7)).toISOString().slice(0, 10);

  const missingDates = await api('GET', '/labs/reports/utilization', { token: tokens.manager });
  check('GET /labs/reports/utilization without from/to -> 400', missingDates.status === 400, missingDates.body);

  const asStudent = await api('GET', `/labs/reports/utilization?from=${today}&to=${nextWeek}`, { token: tokens.student1 });
  check('GET /labs/reports/utilization as STUDENT -> 403', asStudent.status === 403, asStudent.body);

  const json = await api('GET', `/labs/reports/utilization?from=${today}&to=${nextWeek}`, { token: tokens.manager });
  check('GET /labs/reports/utilization -> 200 with labs[]', json.status === 200 && Array.isArray(json.body?.data?.labs), json.body);

  const csv = await api('GET', `/labs/reports/utilization?from=${today}&to=${nextWeek}&format=csv`, { token: tokens.manager });
  check('GET /labs/reports/utilization?format=csv -> 200 CSV', csv.status === 200 && typeof csv.body === 'string' && csv.body.startsWith('Lab ID'), csv.body);
}

/* ═══════════════════════════ EQUIPMENT (Prompt 5) ════════════════════════ */

async function testEquipmentInventory() {
  console.log('\n=== Equipment: inventory & live status (UC-25/IT-01) ===');

  const noToken = await api('GET', '/equipment');
  check('GET /equipment without token -> 401', noToken.status === 401, noToken.body);

  const list = await api('GET', '/equipment', { token: tokens.student1 });
  check('GET /equipment -> 200', list.status === 200, list.body);
  const seeded = list.body?.data?.find((e) => e._id === equipmentId);
  check('  includes seeded equipment with liveStatus AVAILABLE', seeded?.liveStatus === 'AVAILABLE', seeded);

  const detail = await api('GET', `/equipment/${equipmentId}`, { token: tokens.student1 });
  check('GET /equipment/:id -> 200', detail.status === 200 && detail.body?.data?.liveStatus === 'AVAILABLE', detail.body);
  check('  no active checkout/maintenance yet', detail.body?.data?.activeCheckout == null && detail.body?.data?.activeMaintenance == null, detail.body);

  const badId = await api('GET', '/equipment/not-an-id', { token: tokens.student1 });
  check('GET /equipment/<bad-id> -> 400', badId.status === 400, badId.body);

  const notFound = await api('GET', '/equipment/000000000000000000000000', { token: tokens.student1 });
  check('GET /equipment/<nonexistent> -> 404', notFound.status === 404, notFound.body);
}

async function testEquipmentRequestApproval() {
  console.log('\n=== Equipment: checkout request & approval (UC-26/27/29, IT-02) ===');

  const start = new Date(Date.now() + hours(48));
  const end = new Date(Date.now() + hours(50));

  const missing = await api('POST', `/equipment/${equipmentId}/request`, { token: tokens.student1, body: {} });
  check('POST /equipment/:id/request missing fields -> 400', missing.status === 400, missing.body);

  const create = await api('POST', `/equipment/${equipmentId}/request`, {
    token: tokens.student1,
    body: { startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Class presentation' },
  });
  check('POST /equipment/:id/request -> 201 PENDING', create.status === 201 && create.body?.data?.status === 'PENDING', create.body);
  equipmentBookingId = create.body?.data?._id;

  const conflict = await api('POST', `/equipment/${equipmentId}/request`, {
    token: tokens.student2,
    body: { startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Overlapping request' },
  });
  check('POST /equipment/:id/request overlapping window -> 409', conflict.status === 409, conflict.body);

  const myBookings = await api('GET', '/equipment/bookings/me', { token: tokens.student1 });
  check('GET /equipment/bookings/me -> includes request', myBookings.status === 200 && myBookings.body?.data?.some((b) => b._id === equipmentBookingId), myBookings.body);

  const approveAsStudent = await api('PUT', `/equipment/bookings/${equipmentBookingId}/approve`, { token: tokens.student1 });
  check('PUT /equipment/bookings/:id/approve as STUDENT -> 403', approveAsStudent.status === 403, approveAsStudent.body);

  const approve = await api('PUT', `/equipment/bookings/${equipmentBookingId}/approve`, { token: tokens.manager });
  check('PUT /equipment/bookings/:id/approve as LAB_MANAGER -> 200 CONFIRMED', approve.status === 200 && approve.body?.data?.status === 'CONFIRMED', approve.body);
}

async function testEquipmentCheckoutCheckin() {
  console.log('\n=== Equipment: checkout & check-in (UC-03/04, IT-02/03) ===');

  const checkoutAsStudent = await api('POST', '/equipment/checkout', {
    token: tokens.student1,
    body: { bookingId: equipmentBookingId, conditionAtCheckout: 'Good' },
  });
  check('POST /equipment/checkout as STUDENT -> 403', checkoutAsStudent.status === 403, checkoutAsStudent.body);

  const checkout = await api('POST', '/equipment/checkout', {
    token: tokens.manager,
    body: { bookingId: equipmentBookingId, conditionAtCheckout: 'Good' },
  });
  check('POST /equipment/checkout -> 201 ACTIVE', checkout.status === 201 && checkout.body?.data?.status === 'ACTIVE', checkout.body);
  checkoutId = checkout.body?.data?._id;

  const afterCheckout = await api('GET', `/equipment/${equipmentId}`, { token: tokens.student1 });
  check('  resource liveStatus -> CHECKED_OUT after checkout', afterCheckout.body?.data?.liveStatus === 'CHECKED_OUT', afterCheckout.body);
  check('  activeCheckout populated', afterCheckout.body?.data?.activeCheckout?._id === checkoutId, afterCheckout.body);

  const doubleCheckout = await api('POST', '/equipment/checkout', {
    token: tokens.manager,
    body: { bookingId: equipmentBookingId, conditionAtCheckout: 'Good' },
  });
  check('Re-checkout of a COMPLETED booking -> 400', doubleCheckout.status === 400, doubleCheckout.body);

  const checkinAsStudent = await api('PUT', `/equipment/checkin/${checkoutId}`, {
    token: tokens.student1,
    body: { conditionAtReturn: 'Good' },
  });
  check('PUT /equipment/checkin/:id as STUDENT -> 403', checkinAsStudent.status === 403, checkinAsStudent.body);

  const checkin = await api('PUT', `/equipment/checkin/${checkoutId}`, {
    token: tokens.manager,
    body: { conditionAtReturn: 'Good - returned on time' },
  });
  check('PUT /equipment/checkin/:id -> 200 RETURNED', checkin.status === 200 && checkin.body?.data?.status === 'RETURNED', checkin.body);

  const afterCheckin = await api('GET', `/equipment/${equipmentId}`, { token: tokens.student1 });
  check('  resource liveStatus -> AVAILABLE after check-in', afterCheckin.body?.data?.liveStatus === 'AVAILABLE', afterCheckin.body);

  const doubleCheckin = await api('PUT', `/equipment/checkin/${checkoutId}`, {
    token: tokens.manager,
    body: { conditionAtReturn: 'Good' },
  });
  check('Re-checkin an already-RETURNED checkout -> 400', doubleCheckin.status === 400, doubleCheckin.body);

  const overdueAsStudent = await api('GET', '/equipment/checkout/overdue', { token: tokens.student1 });
  check('GET /equipment/checkout/overdue as STUDENT -> 403', overdueAsStudent.status === 403, overdueAsStudent.body);

  const overdue = await api('GET', '/equipment/checkout/overdue', { token: tokens.manager });
  check('GET /equipment/checkout/overdue -> 200', overdue.status === 200 && Array.isArray(overdue.body?.data), overdue.body);
}

async function testEquipmentMaintenance() {
  console.log('\n=== Equipment: maintenance logging (UC-30) ===');

  const logAsStudent = await api('POST', `/equipment/${equipmentId}/maintenance`, {
    token: tokens.student1,
    body: { description: 'Bulb needs replacing', priority: 'HIGH' },
  });
  check('POST /equipment/:id/maintenance as STUDENT -> 403', logAsStudent.status === 403, logAsStudent.body);

  const missing = await api('POST', `/equipment/${equipmentId}/maintenance`, { token: tokens.manager, body: {} });
  check('POST /equipment/:id/maintenance missing description -> 400', missing.status === 400, missing.body);

  const log = await api('POST', `/equipment/${equipmentId}/maintenance`, {
    token: tokens.manager,
    body: { description: 'Bulb needs replacing', priority: 'HIGH' },
  });
  check('POST /equipment/:id/maintenance -> 201 REPORTED', log.status === 201 && log.body?.data?.status === 'REPORTED', log.body);
  maintenanceId = log.body?.data?._id;

  const afterLog = await api('GET', `/equipment/${equipmentId}`, { token: tokens.student1 });
  check('  resource liveStatus -> MAINTENANCE', afterLog.body?.data?.liveStatus === 'MAINTENANCE', afterLog.body);
  check('  activeMaintenance populated', afterLog.body?.data?.activeMaintenance?._id === maintenanceId, afterLog.body);

  const history = await api('GET', `/equipment/${equipmentId}/maintenance`, { token: tokens.manager });
  check('GET /equipment/:id/maintenance -> includes log', history.status === 200 && history.body?.data?.some((m) => m._id === maintenanceId), history.body);

  const complete = await api('PUT', `/equipment/maintenance/${maintenanceId}/complete`, {
    token: tokens.manager,
    body: { resolutionNotes: 'Bulb replaced' },
  });
  check('PUT /equipment/maintenance/:id/complete -> 200 RESOLVED', complete.status === 200 && complete.body?.data?.status === 'RESOLVED', complete.body);

  const afterComplete = await api('GET', `/equipment/${equipmentId}`, { token: tokens.student1 });
  check('  resource liveStatus -> AVAILABLE after maintenance resolved', afterComplete.body?.data?.liveStatus === 'AVAILABLE', afterComplete.body);

  const doubleComplete = await api('PUT', `/equipment/maintenance/${maintenanceId}/complete`, {
    token: tokens.manager,
    body: { resolutionNotes: 'Already done' },
  });
  check('Completing an already-RESOLVED entry -> 400', doubleComplete.status === 400, doubleComplete.body);
}

async function testEquipmentReports() {
  console.log('\n=== Equipment: usage reporting (UC-32) ===');

  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + hours(24 * 7)).toISOString().slice(0, 10);

  const missingDates = await api('GET', '/equipment/reports/usage', { token: tokens.manager });
  check('GET /equipment/reports/usage without from/to -> 400', missingDates.status === 400, missingDates.body);

  const asStudent = await api('GET', `/equipment/reports/usage?from=${today}&to=${nextWeek}`, { token: tokens.student1 });
  check('GET /equipment/reports/usage as STUDENT -> 403', asStudent.status === 403, asStudent.body);

  const json = await api('GET', `/equipment/reports/usage?from=${today}&to=${nextWeek}`, { token: tokens.manager });
  check('GET /equipment/reports/usage -> 200 with equipment[]', json.status === 200 && Array.isArray(json.body?.data?.equipment), json.body);
  const entry = json.body?.data?.equipment?.find((e) => e.equipmentId === equipmentId);
  check('  seeded equipment has totalCheckouts >= 1', (entry?.totalCheckouts || 0) >= 1, entry);

  const csv = await api('GET', `/equipment/reports/usage?from=${today}&to=${nextWeek}&format=csv`, { token: tokens.manager });
  check('GET /equipment/reports/usage?format=csv -> 200 CSV', csv.status === 200 && typeof csv.body === 'string' && csv.body.startsWith('Equipment ID'), csv.body);
}

/* ════════════════ IT-03/IT-04: reminders, overdue & restriction ═════════════ */

async function testOverdueAndRestriction() {
  console.log('\n=== Equipment: overdue reminder job & IT-04 restriction ===');

  const { processEquipmentReminders } = require('../src/modules/equipment/service');
  const Checkout = require('../src/models/Checkout');
  const User = require('../src/models/User');

  const start = new Date(Date.now() + hours(72));
  const end = new Date(Date.now() + hours(74));

  const request = await api('POST', `/equipment/${equipment2Id}/request`, {
    token: tokens.student2,
    body: { startTime: start.toISOString(), endTime: end.toISOString(), purpose: 'Overdue scenario' },
  });
  check('Setup: student2 requests equipment2 -> 201', request.status === 201, request.body);
  const bookingId = request.body?.data?._id;

  const approve = await api('PUT', `/equipment/bookings/${bookingId}/approve`, { token: tokens.manager });
  check('Setup: manager approves equipment2 booking -> 200', approve.status === 200, approve.body);

  const checkout = await api('POST', '/equipment/checkout', {
    token: tokens.manager,
    body: { bookingId, conditionAtCheckout: 'Good' },
  });
  check('Setup: manager checks out equipment2 -> 201', checkout.status === 201, checkout.body);
  const overdueCheckoutId = checkout.body?.data?._id;

  /* Force this checkout into the past so the reminder job treats it as overdue */
  await Checkout.findByIdAndUpdate(overdueCheckoutId, {
    dueTime: new Date(Date.now() - hours(24)),
    status: 'ACTIVE',
  });

  const result = await processEquipmentReminders();
  check('processEquipmentReminders() flags the overdue checkout', result.newlyOverdue >= 1, result);

  const flagged = await Checkout.findById(overdueCheckoutId).lean();
  check('  Checkout status -> OVERDUE', flagged.status === 'OVERDUE', flagged);

  const restrictedUser = await User.findById(userIds.student2).lean();
  check('  User.equipmentRestricted -> true', restrictedUser.equipmentRestricted === true, restrictedUser);

  const overdueList = await api('GET', '/equipment/checkout/overdue', { token: tokens.manager });
  check('GET /equipment/checkout/overdue -> includes overdue checkout', overdueList.body?.data?.some((c) => c._id === overdueCheckoutId), overdueList.body);

  const blockedRequest = await api('POST', `/equipment/${equipmentId}/request`, {
    token: tokens.student2,
    body: {
      startTime: new Date(Date.now() + hours(96)).toISOString(),
      endTime: new Date(Date.now() + hours(98)).toISOString(),
      purpose: 'Should be blocked',
    },
  });
  check('Restricted user POST /equipment/:id/request -> 403', blockedRequest.status === 403, blockedRequest.body);

  const checkin = await api('PUT', `/equipment/checkin/${overdueCheckoutId}`, {
    token: tokens.manager,
    body: { conditionAtReturn: 'Returned late' },
  });
  check('Manager checks in the overdue item -> 200', checkin.status === 200, checkin.body);

  const unrestrictedUser = await User.findById(userIds.student2).lean();
  check('  User.equipmentRestricted -> false after check-in', unrestrictedUser.equipmentRestricted === false, unrestrictedUser);

  const allowedRequest = await api('POST', `/equipment/${equipmentId}/request`, {
    token: tokens.student2,
    body: {
      startTime: new Date(Date.now() + hours(96)).toISOString(),
      endTime: new Date(Date.now() + hours(98)).toISOString(),
      purpose: 'Should now be allowed',
    },
  });
  check('Unrestricted user POST /equipment/:id/request -> 201', allowedRequest.status === 201, allowedRequest.body);
}

async function cleanup() {
  console.log('\n=== Cleanup ===');

  const Resource = require('../src/models/Resource');
  const Booking = require('../src/models/Booking');
  const Checkout = require('../src/models/Checkout');
  const MaintenanceLog = require('../src/models/MaintenanceLog');
  const User = require('../src/models/User');

  const resources = await Resource.find({ name: { $regex: `SmokeTest.*${RUN}` } });
  const resourceIds = resources.map((r) => r._id);

  await Booking.deleteMany({ resource: { $in: resourceIds } });
  await Checkout.deleteMany({ resource: { $in: resourceIds } });
  await MaintenanceLog.deleteMany({ resource: { $in: resourceIds } });
  await Resource.deleteMany({ _id: { $in: resourceIds } });

  /* AuditLog is append-only/immutable by design — its smoke-test entries are
     left in place rather than deleted (consistent with the auth+library smoke test). */
  const users = await User.find({ email: { $regex: `${RUN}@test\\.com$` } });
  const userObjIds = users.map((u) => u._id);
  await User.deleteMany({ _id: { $in: userObjIds } });

  console.log(`  Removed ${resourceIds.length} test resources, their bookings/checkouts/maintenance logs, and ${userObjIds.length} test users.`);
  await mongoose.disconnect();
}

(async () => {
  try {
    await setup();
    await testLabsSchedule();
    await testLabsBookingFlow();
    await testLabsCancelAndUtilization();
    await testEquipmentInventory();
    await testEquipmentRequestApproval();
    await testEquipmentCheckoutCheckin();
    await testEquipmentMaintenance();
    await testEquipmentReports();
    await testOverdueAndRestriction();
  } catch (err) {
    console.error('\nFATAL ERROR during tests:', err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
