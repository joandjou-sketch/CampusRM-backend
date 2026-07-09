'use strict';

/**
 * End-to-end smoke test for the Logbook and Bus modules.
 * Run the server first (`npm run dev`), then in another terminal:
 *   node scripts/logbook-bus-smoke-test.js
 *
 * Exercises every implemented route, role-based access control, conflict
 * detection, and key edge cases (400/403/404/409), then cleans up the data
 * it created.
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
  admin: `smoke.admin.${RUN}@test.com`,
  faculty: `smoke.faculty.${RUN}@test.com`,
  student1: `smoke.student1.${RUN}@test.com`,
  student2: `smoke.student2.${RUN}@test.com`,
  manager: `smoke.manager.${RUN}@test.com`,
};
const PASSWORD = 'password123';
const tokens = {};
const userIds = {};

function days(n) {
  return n * 24 * 60 * 60 * 1000;
}

async function setup() {
  console.log('\n=== Setup (register + login) ===');

  for (const [role, email] of [
    ['ADMIN', emails.admin],
    ['FACULTY', emails.faculty],
    ['STUDENT', emails.student1],
    ['STUDENT', emails.student2],
    ['LAB_MANAGER', emails.manager],
  ]) {
    const r = await api('POST', '/auth/register', {
      body: { fullName: `Smoke ${role} ${RUN}`, email, password: PASSWORD, role },
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

/* ═══════════════════════════ LOGBOOK MODULE ══════════════════════════════ */

let subjectId;
let classLogId;
let assignmentId;

async function testLogbookSubjects() {
  console.log('\n=== Logbook: subjects & enrollment ===');

  const noToken = await api('GET', '/logbook/subjects');
  check('GET /logbook/subjects without token -> 401', noToken.status === 401, noToken.body);

  const asFaculty = await api('POST', '/logbook/subjects', {
    token: tokens.faculty,
    body: { name: `Smoke Subject ${RUN}`, code: `SMK${RUN}`, facultyId: userIds.faculty, totalPlannedSessions: 5 },
  });
  check('POST /logbook/subjects as FACULTY -> 403', asFaculty.status === 403, asFaculty.body);

  const badFaculty = await api('POST', '/logbook/subjects', {
    token: tokens.admin,
    body: { name: `Smoke Subject Bad ${RUN}`, facultyId: userIds.student1 },
  });
  check('POST /logbook/subjects with non-FACULTY facultyId -> 400', badFaculty.status === 400, badFaculty.body);

  const create = await api('POST', '/logbook/subjects', {
    token: tokens.admin,
    body: { name: `Smoke Subject ${RUN}`, code: `SMK${RUN}`, facultyId: userIds.faculty, totalPlannedSessions: 5 },
  });
  check('POST /logbook/subjects as ADMIN -> 201', create.status === 201, create.body);
  subjectId = create.body?.data?._id;

  const listFaculty = await api('GET', '/logbook/subjects', { token: tokens.faculty });
  check('GET /logbook/subjects (faculty) -> includes subject', listFaculty.status === 200 && listFaculty.body?.data?.some((s) => s._id === subjectId), listFaculty.body);

  const listStudentBefore = await api('GET', '/logbook/subjects', { token: tokens.student1 });
  check('GET /logbook/subjects (student, not enrolled) -> empty', listStudentBefore.status === 200 && listStudentBefore.body?.data?.length === 0, listStudentBefore.body);

  const updateAsStudent = await api('PUT', `/logbook/subjects/${subjectId}`, { token: tokens.student1, body: { totalPlannedSessions: 10 } });
  check('PUT /logbook/subjects/:id as STUDENT -> 403', updateAsStudent.status === 403, updateAsStudent.body);

  const update = await api('PUT', `/logbook/subjects/${subjectId}`, { token: tokens.faculty, body: { totalPlannedSessions: 10 } });
  check('PUT /logbook/subjects/:id (owner faculty) -> 200', update.status === 200 && update.body?.data?.totalPlannedSessions === 10, update.body);

  const enroll1 = await api('POST', `/logbook/subjects/${subjectId}/enroll`, { token: tokens.faculty, body: { studentId: userIds.student1 } });
  check('POST /logbook/subjects/:id/enroll student1 -> 201', enroll1.status === 201, enroll1.body);

  const enrollDup = await api('POST', `/logbook/subjects/${subjectId}/enroll`, { token: tokens.faculty, body: { studentId: userIds.student1 } });
  check('POST /logbook/subjects/:id/enroll duplicate -> 409', enrollDup.status === 409, enrollDup.body);

  const enroll2 = await api('POST', `/logbook/subjects/${subjectId}/enroll`, { token: tokens.faculty, body: { studentId: userIds.student2 } });
  check('POST /logbook/subjects/:id/enroll student2 -> 201', enroll2.status === 201, enroll2.body);

  const students = await api('GET', `/logbook/subjects/${subjectId}/students`, { token: tokens.faculty });
  check('GET /logbook/subjects/:id/students -> 2 students', students.status === 200 && students.body?.data?.length === 2, students.body);

  const listStudentAfter = await api('GET', '/logbook/subjects', { token: tokens.student1 });
  check('GET /logbook/subjects (student, enrolled) -> includes subject', listStudentAfter.status === 200 && listStudentAfter.body?.data?.some((s) => s._id === subjectId), listStudentAfter.body);
}

async function testLogbookClassLogsAndAttendance() {
  console.log('\n=== Logbook: class logs & attendance (UC-47/48/49) ===');

  const today = new Date().toISOString().slice(0, 10);

  const missing = await api('POST', '/logbook/class-logs', { token: tokens.faculty, body: { subjectId } });
  check('POST /logbook/class-logs missing fields -> 400', missing.status === 400, missing.body);

  const create = await api('POST', '/logbook/class-logs', {
    token: tokens.faculty,
    body: { subjectId, date: today, period: 1, topic: 'Introduction', lessonConducted: true },
  });
  check('POST /logbook/class-logs -> 201', create.status === 201, create.body);
  classLogId = create.body?.data?._id;

  const dup = await api('POST', '/logbook/class-logs', {
    token: tokens.faculty,
    body: { subjectId, date: today, period: 1, topic: 'Duplicate session' },
  });
  check('POST /logbook/class-logs duplicate subject/date/period -> 409', dup.status === 409 && dup.body?.data?.existingClassLogId === classLogId, dup.body);

  const logsAsOwner = await api('GET', `/logbook/class-logs/subject/${subjectId}`, { token: tokens.faculty });
  check('GET /logbook/class-logs/subject/:id (owner) -> 1 log', logsAsOwner.status === 200 && logsAsOwner.body?.data?.length === 1, logsAsOwner.body);

  const logsAsStudent = await api('GET', `/logbook/class-logs/subject/${subjectId}`, { token: tokens.student1 });
  check('GET /logbook/class-logs/subject/:id (enrolled student) -> 1 log', logsAsStudent.status === 200 && logsAsStudent.body?.data?.length === 1, logsAsStudent.body);

  const rosterMismatch = await api('POST', '/logbook/attendance', {
    token: tokens.faculty,
    body: { logId: classLogId, attendance: [{ studentId: userIds.student1, status: 'PRESENT' }] },
  });
  check('POST /logbook/attendance with incomplete roster -> 400', rosterMismatch.status === 400, rosterMismatch.body);

  const record = await api('POST', '/logbook/attendance', {
    token: tokens.faculty,
    body: {
      logId: classLogId,
      attendance: [
        { studentId: userIds.student1, status: 'PRESENT' },
        { studentId: userIds.student2, status: 'LATE' },
      ],
    },
  });
  check('POST /logbook/attendance -> 201', record.status === 201, record.body);
  check('  returns per-student stats', Array.isArray(record.body?.data?.students) && record.body.data.students.length === 2, record.body);

  const recordAgain = await api('POST', '/logbook/attendance', {
    token: tokens.faculty,
    body: { logId: classLogId, attendance: [{ studentId: userIds.student1, status: 'PRESENT' }, { studentId: userIds.student2, status: 'LATE' }] },
  });
  check('POST /logbook/attendance again for same log -> 409', recordAgain.status === 409, recordAgain.body);

  const edit = await api('PUT', `/logbook/attendance/${classLogId}`, {
    token: tokens.faculty,
    body: {
      attendance: [
        { studentId: userIds.student1, status: 'ABSENT' },
        { studentId: userIds.student2, status: 'PRESENT' },
      ],
    },
  });
  check('PUT /logbook/attendance/:logId -> 200', edit.status === 200, edit.body);

  const summaryStudent = await api('GET', `/logbook/attendance/summary?subjectId=${subjectId}`, { token: tokens.student1 });
  check('GET /logbook/attendance/summary (student) -> 200', summaryStudent.status === 200 && Array.isArray(summaryStudent.body?.data), summaryStudent.body);
  check('  student1 attendance% = 0 (ABSENT)', summaryStudent.body?.data?.[0]?.percent === 0, summaryStudent.body);

  const summaryFacultyMissing = await api('GET', '/logbook/attendance/summary', { token: tokens.faculty });
  check('GET /logbook/attendance/summary (faculty, no subjectId) -> 400', summaryFacultyMissing.status === 400, summaryFacultyMissing.body);

  const summaryFaculty = await api('GET', `/logbook/attendance/summary?subjectId=${subjectId}`, { token: tokens.faculty });
  check('GET /logbook/attendance/summary (faculty) -> 2 students', summaryFaculty.status === 200 && summaryFaculty.body?.data?.length === 2, summaryFaculty.body);

  const reportAsStudent = await api('GET', `/logbook/attendance/report?subjectId=${subjectId}`, { token: tokens.student1 });
  check('GET /logbook/attendance/report as STUDENT -> 403', reportAsStudent.status === 403, reportAsStudent.body);

  const reportJson = await api('GET', `/logbook/attendance/report?subjectId=${subjectId}`, { token: tokens.faculty });
  check('GET /logbook/attendance/report (json) -> 200 with rows[]', reportJson.status === 200 && Array.isArray(reportJson.body?.data?.rows), reportJson.body);

  const reportCsv = await api('GET', `/logbook/attendance/report?subjectId=${subjectId}&format=csv`, { token: tokens.faculty });
  check('GET /logbook/attendance/report?format=csv -> 200 CSV', reportCsv.status === 200 && typeof reportCsv.body === 'string' && reportCsv.body.startsWith('Subject'), reportCsv.body);
}

async function testLogbookMarksAndProgress() {
  console.log('\n=== Logbook: internal marks, assignments & progress (UC-50/51/52/53/54, AL-01/03) ===');

  const badComponent = await api('POST', '/logbook/internal-marks', {
    token: tokens.faculty,
    body: { studentId: userIds.student1, subjectId, component: 'FINAL', marks: 5, maxMarks: 10 },
  });
  check('POST /logbook/internal-marks invalid component -> 400', badComponent.status === 400, badComponent.body);

  const recordMark = await api('POST', '/logbook/internal-marks', {
    token: tokens.faculty,
    body: { studentId: userIds.student1, subjectId, component: 'QUIZ', marks: 8, maxMarks: 10 },
  });
  check('POST /logbook/internal-marks -> 201', recordMark.status === 201 && recordMark.body?.data?.marks === 8, recordMark.body);

  const getOwnMarks = await api('GET', `/logbook/internal-marks/student/${userIds.student1}?subjectId=${subjectId}`, { token: tokens.student1 });
  check('GET /logbook/internal-marks/student/:id (self) -> 200', getOwnMarks.status === 200 && getOwnMarks.body?.data?.[0]?.total === 8, getOwnMarks.body);

  const getOtherMarks = await api('GET', `/logbook/internal-marks/student/${userIds.student1}?subjectId=${subjectId}`, { token: tokens.student2 });
  check('GET /logbook/internal-marks/student/:id (other student) -> 403', getOtherMarks.status === 403, getOtherMarks.body);

  const pastDue = await api('POST', '/logbook/assignments', {
    token: tokens.faculty,
    body: { subjectId, title: 'Past assignment', dueDate: new Date(Date.now() - days(1)).toISOString(), maxMarks: 20 },
  });
  check('POST /logbook/assignments with past dueDate -> 400', pastDue.status === 400, pastDue.body);

  const createAssignment = await api('POST', '/logbook/assignments', {
    token: tokens.faculty,
    body: { subjectId, title: `Smoke Assignment ${RUN}`, dueDate: new Date(Date.now() + days(7)).toISOString(), maxMarks: 20 },
  });
  check('POST /logbook/assignments -> 201', createAssignment.status === 201, createAssignment.body);
  assignmentId = createAssignment.body?.data?._id;

  const recordAssignmentMarks = await api('POST', `/logbook/assignments/${assignmentId}/marks`, {
    token: tokens.faculty,
    body: { marks: [{ studentId: userIds.student1, marks: 18 }, { studentId: userIds.student2, marks: 14 }] },
  });
  check('POST /logbook/assignments/:id/marks -> 201', recordAssignmentMarks.status === 201 && recordAssignmentMarks.body?.data?.length === 2, recordAssignmentMarks.body);

  const studentMarks = await api('GET', `/logbook/assignments/student/${userIds.student1}?subjectId=${subjectId}`, { token: tokens.student1 });
  check('GET /logbook/assignments/student/:id -> includes class average', studentMarks.status === 200 && studentMarks.body?.data?.[0]?.marks === 18 && studentMarks.body?.data?.[0]?.classAverage === 16, studentMarks.body);

  const progressStudent = await api('GET', `/logbook/progress/subject/${subjectId}`, { token: tokens.student1 });
  check('GET /logbook/progress/subject/:id (student) -> 200', progressStudent.status === 200 && progressStudent.body?.data?.topicsCovered === 1, progressStudent.body);
  check('  includes myAttendance & assignmentMarks', !!progressStudent.body?.data?.myAttendance && Array.isArray(progressStudent.body?.data?.assignmentMarks), progressStudent.body);

  const progressFaculty = await api('GET', `/logbook/progress/subject/${subjectId}`, { token: tokens.faculty });
  check('GET /logbook/progress/subject/:id (faculty) -> includes classAttendance', progressFaculty.status === 200 && Array.isArray(progressFaculty.body?.data?.classAttendance), progressFaculty.body);

  const progressManager = await api('GET', `/logbook/progress/subject/${subjectId}`, { token: tokens.manager });
  check('GET /logbook/progress/subject/:id (manager) -> 200', progressManager.status === 200, progressManager.body);
}

/* ═══════════════════════════════ BUS MODULE ══════════════════════════════ */

let bus1Id;
let routeId;
let trip1Id;
let trip2Id;
let booking1Id;
let booking2Id;
let maintenanceId;

const date7 = new Date(Date.now() + days(7)).toISOString().slice(0, 10);

async function testBusFleetAndRoutes() {
  console.log('\n=== Bus: fleet & route management (UC-21, RM/Admin) ===');

  const noToken = await api('GET', '/bus/buses');
  check('GET /bus/buses without token -> 401', noToken.status === 401, noToken.body);

  const asStudent = await api('POST', '/bus/buses', { token: tokens.student1, body: { name: `Smoke Bus ${RUN}`, capacity: 2 } });
  check('POST /bus/buses as STUDENT -> 403', asStudent.status === 403, asStudent.body);

  const missingCapacity = await api('POST', '/bus/buses', { token: tokens.manager, body: { name: `Smoke Bus Bad ${RUN}` } });
  check('POST /bus/buses missing capacity -> 400', missingCapacity.status === 400, missingCapacity.body);

  const createBus = await api('POST', '/bus/buses', { token: tokens.manager, body: { name: `Smoke Bus 1 ${RUN}`, capacity: 2, location: 'Main Garage' } });
  check('POST /bus/buses -> 201', createBus.status === 201 && createBus.body?.data?.type === 'BUS', createBus.body);
  bus1Id = createBus.body?.data?._id;

  const list = await api('GET', '/bus/buses', { token: tokens.student1 });
  check('GET /bus/buses -> includes new bus', list.status === 200 && list.body?.data?.some((b) => b._id === bus1Id), list.body);

  const update = await api('PUT', `/bus/buses/${bus1Id}`, { token: tokens.manager, body: { location: 'North Garage' } });
  check('PUT /bus/buses/:id -> 200', update.status === 200 && update.body?.data?.location === 'North Garage', update.body);

  const missingRouteFields = await api('POST', '/bus/routes', { token: tokens.manager, body: { name: `Smoke Route ${RUN}` } });
  check('POST /bus/routes missing fields -> 400', missingRouteFields.status === 400, missingRouteFields.body);

  const createRoute = await api('POST', '/bus/routes', {
    token: tokens.manager,
    body: { name: `Smoke Route ${RUN}`, origin: 'Campus', destination: 'Town Center', stops: ['Library', 'Hostel'], schedule: ['08:00', '12:00'] },
  });
  check('POST /bus/routes -> 201', createRoute.status === 201, createRoute.body);
  routeId = createRoute.body?.data?._id;

  const listRoutes = await api('GET', '/bus/routes', { token: tokens.student1 });
  check('GET /bus/routes -> includes new route', listRoutes.status === 200 && listRoutes.body?.data?.some((r) => r._id === routeId), listRoutes.body);

  const updateRoute = await api('PUT', `/bus/routes/${routeId}`, { token: tokens.manager, body: { destination: 'Downtown' } });
  check('PUT /bus/routes/:id -> 200', updateRoute.status === 200 && updateRoute.body?.data?.destination === 'Downtown', updateRoute.body);
}

async function testBusTripSchedulingAndConflicts() {
  console.log('\n=== Bus: trip scheduling & conflict detection (BUS-01/02, RM-05) ===');

  const asStudent = await api('POST', '/bus/trips', {
    token: tokens.student1,
    body: { busId: bus1Id, routeId, date: date7, departureTime: '08:00', arrivalTime: '10:00' },
  });
  check('POST /bus/trips as STUDENT -> 403', asStudent.status === 403, asStudent.body);

  const missing = await api('POST', '/bus/trips', { token: tokens.manager, body: { busId: bus1Id, routeId } });
  check('POST /bus/trips missing fields -> 400', missing.status === 400, missing.body);

  const create1 = await api('POST', '/bus/trips', {
    token: tokens.manager,
    body: { busId: bus1Id, routeId, date: date7, departureTime: '08:00', arrivalTime: '10:00' },
  });
  check('POST /bus/trips trip1 -> 201 CONFIRMED', create1.status === 201 && create1.body?.data?.status === 'CONFIRMED', create1.body);
  trip1Id = create1.body?.data?._id;

  const conflict = await api('POST', '/bus/trips', {
    token: tokens.manager,
    body: { busId: bus1Id, routeId, date: date7, departureTime: '09:00', arrivalTime: '11:00' },
  });
  check('POST /bus/trips overlapping window -> 409', conflict.status === 409, conflict.body);
  check('  409 includes conflicts & suggestedAlternatives', !!conflict.body?.data?.conflicts && Array.isArray(conflict.body?.data?.suggestedAlternatives), conflict.body);

  const overrideNoJustification = await api('POST', '/bus/trips', {
    token: tokens.manager,
    body: { busId: bus1Id, routeId, date: date7, departureTime: '09:00', arrivalTime: '11:00', override: true },
  });
  check('POST /bus/trips override without justification -> 400', overrideNoJustification.status === 400, overrideNoJustification.body);

  const create2 = await api('POST', '/bus/trips', {
    token: tokens.manager,
    body: { busId: bus1Id, routeId, date: date7, departureTime: '12:00', arrivalTime: '14:00' },
  });
  check('POST /bus/trips trip2 (non-overlapping) -> 201', create2.status === 201, create2.body);
  trip2Id = create2.body?.data?._id;

  const list = await api('GET', `/bus/trips?routeId=${routeId}&date=${date7}`, { token: tokens.student1 });
  check('GET /bus/trips?routeId&date -> 2 trips', list.status === 200 && list.body?.data?.length === 2, list.body);
}

async function testBusAvailabilityAndReservations() {
  console.log('\n=== Bus: seat availability & reservations (UC-16/17/18/19/20) ===');

  const availBefore = await api('GET', `/bus/availability?routeId=${routeId}&date=${date7}`, { token: tokens.student1 });
  check('GET /bus/availability -> 200', availBefore.status === 200 && availBefore.body?.data?.length === 2, availBefore.body);
  const trip1AvailBefore = availBefore.body?.data?.find((t) => t.tripId === trip1Id);
  check('  trip1 seatsAvailable = 2 (capacity)', trip1AvailBefore?.seatsAvailable === 2, trip1AvailBefore);

  const reserve1 = await api('POST', '/bus/bookings', { token: tokens.student1, body: { tripId: trip1Id, seatNo: 1 } });
  check('POST /bus/bookings student1 seat 1 -> 201', reserve1.status === 201 && reserve1.body?.data?.status === 'CONFIRMED', reserve1.body);
  booking1Id = reserve1.body?.data?._id;

  const seatTaken = await api('POST', '/bus/bookings', { token: tokens.student2, body: { tripId: trip1Id, seatNo: 1 } });
  check('POST /bus/bookings duplicate seat -> 409', seatTaken.status === 409, seatTaken.body);

  const reserve2 = await api('POST', '/bus/bookings', { token: tokens.student2, body: { tripId: trip1Id, seatNo: 2 } });
  check('POST /bus/bookings student2 seat 2 -> 201', reserve2.status === 201, reserve2.body);
  booking2Id = reserve2.body?.data?._id;

  const full = await api('POST', '/bus/bookings', { token: tokens.faculty, body: { tripId: trip1Id, seatNo: 3 } });
  check('POST /bus/bookings on full trip -> 409', full.status === 409, full.body);

  const availAfter = await api('GET', `/bus/availability?routeId=${routeId}&date=${date7}`, { token: tokens.student1 });
  const trip1AvailAfter = availAfter.body?.data?.find((t) => t.tripId === trip1Id);
  check('  trip1 seatsAvailable = 0 after full booking', trip1AvailAfter?.seatsAvailable === 0, trip1AvailAfter);

  const historySelf = await api('GET', `/bus/bookings/user/${userIds.student1}`, { token: tokens.student1 });
  check('GET /bus/bookings/user/:id (self) -> includes booking', historySelf.status === 200 && historySelf.body?.data?.some((b) => b._id === booking1Id), historySelf.body);

  const historyOther = await api('GET', `/bus/bookings/user/${userIds.student1}`, { token: tokens.student2 });
  check('GET /bus/bookings/user/:id (other student) -> 403', historyOther.status === 403, historyOther.body);

  const historyManager = await api('GET', `/bus/bookings/user/${userIds.student1}`, { token: tokens.manager });
  check('GET /bus/bookings/user/:id (manager) -> 200', historyManager.status === 200, historyManager.body);

  const cancelByOther = await api('DELETE', `/bus/bookings/${booking2Id}`, { token: tokens.student1 });
  check('DELETE /bus/bookings/:id by non-owner -> 403', cancelByOther.status === 403, cancelByOther.body);

  const cancel = await api('DELETE', `/bus/bookings/${booking2Id}`, { token: tokens.student2 });
  check('DELETE /bus/bookings/:id by owner (>=2h before departure) -> 200 CANCELLED', cancel.status === 200 && cancel.body?.data?.status === 'CANCELLED', cancel.body);

  const availFreed = await api('GET', `/bus/availability?routeId=${routeId}&date=${date7}`, { token: tokens.student1 });
  const trip1AvailFreed = availFreed.body?.data?.find((t) => t.tripId === trip1Id);
  check('  trip1 seatsAvailable = 1 after cancellation', trip1AvailFreed?.seatsAvailable === 1, trip1AvailFreed);
}

async function testBusTripStatusAndLogging() {
  console.log('\n=== Bus: delay/cancellation & trip logging (UC-24, BUS-03) ===');

  const invalidStatus = await api('PUT', `/bus/trips/${trip2Id}/status`, { token: tokens.manager, body: { status: 'PARKED' } });
  check('PUT /bus/trips/:id/status invalid status -> 400', invalidStatus.status === 400, invalidStatus.body);

  const delay = await api('PUT', `/bus/trips/${trip2Id}/status`, { token: tokens.manager, body: { status: 'DELAYED', reason: 'Heavy traffic' } });
  check('PUT /bus/trips/:id/status DELAYED -> 200', delay.status === 200 && delay.body?.data?.status === 'DELAYED', delay.body);

  const cancelTrip = await api('PUT', `/bus/trips/${trip1Id}/status`, { token: tokens.manager, body: { status: 'CANCELLED', reason: 'Bus unavailable' } });
  check('PUT /bus/trips/:id/status CANCELLED -> 200', cancelTrip.status === 200 && cancelTrip.body?.data?.status === 'CANCELLED', cancelTrip.body);

  const historyAfterCancel = await api('GET', `/bus/bookings/user/${userIds.student1}`, { token: tokens.student1 });
  const seat1AfterCancel = historyAfterCancel.body?.data?.find((b) => b._id === booking1Id);
  check('  student1 seat booking -> CANCELLED after trip cancelled', seat1AfterCancel?.status === 'CANCELLED', seat1AfterCancel);

  const logMissing = await api('POST', `/bus/trips/${trip2Id}/log`, { token: tokens.manager, body: {} });
  check('POST /bus/trips/:id/log missing fields -> 400', logMissing.status === 400, logMissing.body);

  const log = await api('POST', `/bus/trips/${trip2Id}/log`, {
    token: tokens.manager,
    body: {
      driverName: 'Smoke Driver',
      odometerStart: 1000,
      odometerEnd: 1050,
      purpose: 'Scheduled run',
      departedAt: new Date(Date.now() + days(7)).toISOString(),
      returnedAt: new Date(Date.now() + days(7) + 2 * 60 * 60 * 1000).toISOString(),
    },
  });
  check('POST /bus/trips/:id/log -> 201', log.status === 201 && log.body?.data?.odometerEnd === 1050, log.body);
}

async function testBusMaintenanceAndReports() {
  console.log('\n=== Bus: maintenance scheduling (BUS-04) & occupancy report (UC-22/23, BUS-05) ===');

  const asStudent = await api('POST', `/bus/buses/${bus1Id}/maintenance`, { token: tokens.student1, body: { description: 'Oil change', scheduledDate: date7 } });
  check('POST /bus/buses/:id/maintenance as STUDENT -> 403', asStudent.status === 403, asStudent.body);

  const missing = await api('POST', `/bus/buses/${bus1Id}/maintenance`, { token: tokens.manager, body: { description: 'Oil change' } });
  check('POST /bus/buses/:id/maintenance missing scheduledDate -> 400', missing.status === 400, missing.body);

  const schedule = await api('POST', `/bus/buses/${bus1Id}/maintenance`, { token: tokens.manager, body: { description: 'Oil change', scheduledDate: date7, priority: 'HIGH' } });
  check('POST /bus/buses/:id/maintenance -> 201 SCHEDULED', schedule.status === 201 && schedule.body?.data?.status === 'SCHEDULED', schedule.body);
  maintenanceId = schedule.body?.data?._id;

  const busAfterSchedule = await api('GET', '/bus/buses', { token: tokens.student1 });
  const bus1AfterSchedule = busAfterSchedule.body?.data?.find((b) => b._id === bus1Id);
  check('  bus1 status -> MAINTENANCE', bus1AfterSchedule?.status === 'MAINTENANCE', bus1AfterSchedule);

  const complete = await api('PUT', `/bus/maintenance/${maintenanceId}/complete`, { token: tokens.manager, body: { resolutionNotes: 'Oil changed' } });
  check('PUT /bus/maintenance/:id/complete -> 200 RESOLVED', complete.status === 200 && complete.body?.data?.status === 'RESOLVED', complete.body);

  const busAfterComplete = await api('GET', '/bus/buses', { token: tokens.student1 });
  const bus1AfterComplete = busAfterComplete.body?.data?.find((b) => b._id === bus1Id);
  check('  bus1 status -> AVAILABLE after maintenance resolved', bus1AfterComplete?.status === 'AVAILABLE', bus1AfterComplete);

  const doubleComplete = await api('PUT', `/bus/maintenance/${maintenanceId}/complete`, { token: tokens.manager, body: { resolutionNotes: 'Already done' } });
  check('Completing an already-RESOLVED entry -> 400', doubleComplete.status === 400, doubleComplete.body);

  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + days(8)).toISOString().slice(0, 10);

  const asStudentReport = await api('GET', `/bus/reports/occupancy?from=${today}&to=${future}`, { token: tokens.student1 });
  check('GET /bus/reports/occupancy as STUDENT -> 403', asStudentReport.status === 403, asStudentReport.body);

  const missingDates = await api('GET', '/bus/reports/occupancy', { token: tokens.manager });
  check('GET /bus/reports/occupancy without from/to -> 400', missingDates.status === 400, missingDates.body);

  const json = await api('GET', `/bus/reports/occupancy?from=${today}&to=${future}`, { token: tokens.manager });
  check('GET /bus/reports/occupancy (json) -> 200 with buses[]', json.status === 200 && Array.isArray(json.body?.data?.buses), json.body);
  const bus1Report = json.body?.data?.buses?.find((b) => b.busId === bus1Id);
  check('  bus1 report: trips=2, kmTravelled=50', bus1Report?.trips === 2 && bus1Report?.kmTravelled === 50, bus1Report);

  const csv = await api('GET', `/bus/reports/occupancy?from=${today}&to=${future}&format=csv`, { token: tokens.manager });
  check('GET /bus/reports/occupancy?format=csv -> 200 CSV', csv.status === 200 && typeof csv.body === 'string' && csv.body.startsWith('Bus ID'), csv.body);
}

async function testBusSoftDelete() {
  console.log('\n=== Bus: soft delete (routes & buses) ===');

  const removeRoute = await api('DELETE', `/bus/routes/${routeId}`, { token: tokens.manager });
  check('DELETE /bus/routes/:id -> 200', removeRoute.status === 200 && removeRoute.body?.data?.isActive === false, removeRoute.body);

  const listRoutes = await api('GET', '/bus/routes', { token: tokens.student1 });
  check('  retired route no longer listed', !listRoutes.body?.data?.some((r) => r._id === routeId), listRoutes.body);

  const removeBus = await api('DELETE', `/bus/buses/${bus1Id}`, { token: tokens.manager });
  check('DELETE /bus/buses/:id -> 200 RETIRED', removeBus.status === 200 && removeBus.body?.data?.status === 'RETIRED', removeBus.body);
}

/* ════════════════════════════════ Cleanup ═══════════════════════════════ */

async function cleanup() {
  console.log('\n=== Cleanup ===');
  await mongoose.connect(process.env.MONGO_URI);

  const User = require('../src/models/User');
  const Resource = require('../src/models/Resource');
  const Route = require('../src/models/Route');
  const Booking = require('../src/models/Booking');
  const BusSeatBooking = require('../src/models/BusSeatBooking');
  const TripLog = require('../src/models/TripLog');
  const MaintenanceLog = require('../src/models/MaintenanceLog');
  const Subject = require('../src/models/Subject');
  const Enrollment = require('../src/models/Enrollment');
  const ClassLog = require('../src/models/ClassLog');
  const Attendance = require('../src/models/Attendance');
  const Assignment = require('../src/models/Assignment');
  const AssignmentMark = require('../src/models/AssignmentMark');
  const InternalMark = require('../src/models/InternalMark');

  if (subjectId) {
    const classLogs = await ClassLog.find({ subject: subjectId }).select('_id').lean();
    const classLogIds = classLogs.map((c) => c._id);
    await Attendance.deleteMany({ classLog: { $in: classLogIds } });
    await ClassLog.deleteMany({ subject: subjectId });
    if (assignmentId) {
      await AssignmentMark.deleteMany({ assignment: assignmentId });
      await Assignment.deleteMany({ _id: assignmentId });
    }
    await InternalMark.deleteMany({ subject: subjectId });
    await Enrollment.deleteMany({ subject: subjectId });
    await Subject.deleteMany({ _id: subjectId });
  }

  const buses = await Resource.find({ name: { $regex: `SmokeTest?.*${RUN}|Smoke Bus.*${RUN}` } });
  const busIds = buses.map((b) => b._id);
  await BusSeatBooking.deleteMany({ trip: { $in: (await Booking.find({ resource: { $in: busIds } }).select('_id').lean()).map((b) => b._id) } });
  await TripLog.deleteMany({ bus: { $in: busIds } });
  await MaintenanceLog.deleteMany({ resource: { $in: busIds } });
  await Booking.deleteMany({ resource: { $in: busIds } });
  await Resource.deleteMany({ _id: { $in: busIds } });

  await Route.deleteMany({ name: { $regex: `Smoke Route.*${RUN}` } });

  const users = await User.find({ email: { $regex: `${RUN}@test\\.com$` } });
  const userObjIds = users.map((u) => u._id);
  await User.deleteMany({ _id: { $in: userObjIds } });

  console.log(`  Removed Logbook test data, ${busIds.length} bus(es), 1 route, and ${userObjIds.length} test users.`);
  await mongoose.disconnect();
}

(async () => {
  try {
    await setup();
    await testLogbookSubjects();
    await testLogbookClassLogsAndAttendance();
    await testLogbookMarksAndProgress();
    await testBusFleetAndRoutes();
    await testBusTripSchedulingAndConflicts();
    await testBusAvailabilityAndReservations();
    await testBusTripStatusAndLogging();
    await testBusMaintenanceAndReports();
    await testBusSoftDelete();
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
