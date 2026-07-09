'use strict';

const express = require('express');
const router = express.Router();

const {
  createSubjectEntry,
  getSubjects,
  updateSubjectEntry,
  enrollStudentEntry,
  getEnrolledStudents,
  createClassLogEntry,
  getClassLogsForSubject,
  recordAttendanceEntry,
  editAttendanceEntry,
  getAttendanceSummaryStats,
  getAttendanceReportStats,
  recordInternalMarksEntry,
  getStudentInternalMarks,
  createAssignmentEntry,
  recordAssignmentMarksEntry,
  getStudentAssignmentMarks,
  getCourseProgress,
} = require('./controller');

const { authenticate, authorize } = require('../shared');

/* ── Subject & enrollment management (setup, Admin/Faculty) ─────────────── */
router.post('/subjects', authenticate, authorize('ADMIN'), createSubjectEntry);
router.get('/subjects', authenticate, getSubjects);
router.put('/subjects/:id', authenticate, authorize('FACULTY', 'ADMIN'), updateSubjectEntry);
router.post('/subjects/:id/enroll', authenticate, authorize('FACULTY', 'ADMIN'), enrollStudentEntry);
router.get('/subjects/:id/students', authenticate, authorize('FACULTY', 'ADMIN'), getEnrolledStudents);

/* ── Attendance reporting (UC-49, Faculty/Admin) ─────────────────────────── */
router.get('/attendance/report', authenticate, authorize('FACULTY', 'ADMIN'), getAttendanceReportStats);
router.get('/attendance/summary', authenticate, getAttendanceSummaryStats);

/* ── Attendance recording (UC-47, UC-48) ─────────────────────────────────── */
router.post('/attendance', authenticate, authorize('FACULTY'), recordAttendanceEntry);
router.put('/attendance/:logId', authenticate, authorize('FACULTY'), editAttendanceEntry);

/* ── Class logs (AL-02) ───────────────────────────────────────────────────── */
router.post('/class-logs', authenticate, authorize('FACULTY'), createClassLogEntry);
router.get('/class-logs/subject/:id', authenticate, getClassLogsForSubject);

/* ── Internal assessment marks (UC-50, UC-51) ────────────────────────────── */
router.post('/internal-marks', authenticate, authorize('FACULTY'), recordInternalMarksEntry);
router.get('/internal-marks/student/:id', authenticate, getStudentInternalMarks);

/* ── Assignments (UC-52, UC-53, UC-54) ───────────────────────────────────── */
router.post('/assignments', authenticate, authorize('FACULTY'), createAssignmentEntry);
router.post('/assignments/:id/marks', authenticate, authorize('FACULTY'), recordAssignmentMarksEntry);
router.get('/assignments/student/:id', authenticate, getStudentAssignmentMarks);

/* ── Course progress & analytics (AL-01, AL-03) ──────────────────────────── */
router.get('/progress/subject/:id', authenticate, getCourseProgress);

module.exports = router;
