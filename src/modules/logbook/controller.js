'use strict';

const {
  createSubject,
  listSubjects,
  updateSubject,
  enrollStudent,
  listEnrolledStudents,
  createClassLog,
  listClassLogs,
  recordAttendance,
  editAttendance,
  getAttendanceSummary,
  getAttendanceReport,
  recordInternalMarks,
  getInternalMarks,
  createAssignment,
  recordAssignmentMarks,
  getAssignmentMarks,
  getSubjectProgress,
} = require('./service');
const { sendSuccess, sendError } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');
const { sendCsv } = require('../../utils/csv');
const { streamTablePdf } = require('../../utils/pdf');

/* ── Subject & enrollment management ─────────────────────────────────────── */

async function createSubjectEntry(req, res, next) {
  try {
    const { name, code, facultyId, level, program, totalPlannedSessions } = req.body;
    const subject = await createSubject({ name, code, facultyId, level, program, totalPlannedSessions });

    await logAction(req.user._id, 'SUBJECT_CREATED', 'Subject', subject._id, { name, facultyId }, req.ip);

    return sendSuccess(res, subject, 'Subject created', 201);
  } catch (err) {
    return next(err);
  }
}

async function getSubjects(req, res, next) {
  try {
    const subjects = await listSubjects(req.user);
    return sendSuccess(res, subjects, 'Subjects retrieved');
  } catch (err) {
    return next(err);
  }
}

async function updateSubjectEntry(req, res, next) {
  try {
    const subject = await updateSubject(req.params.id, req.user, req.body);
    await logAction(req.user._id, 'SUBJECT_UPDATED', 'Subject', subject._id, req.body, req.ip);
    return sendSuccess(res, subject, 'Subject updated');
  } catch (err) {
    return next(err);
  }
}

async function enrollStudentEntry(req, res, next) {
  try {
    const { studentId } = req.body;
    const enrollment = await enrollStudent(req.params.id, req.user, studentId);
    await logAction(req.user._id, 'STUDENT_ENROLLED', 'Enrollment', enrollment._id, { subject: req.params.id, studentId }, req.ip);
    return sendSuccess(res, enrollment, 'Student enrolled', 201);
  } catch (err) {
    return next(err);
  }
}

async function getEnrolledStudents(req, res, next) {
  try {
    const students = await listEnrolledStudents(req.params.id, req.user);
    return sendSuccess(res, students, 'Enrolled students retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Class logs (AL-02) ──────────────────────────────────────────────────── */

async function createClassLogEntry(req, res, next) {
  try {
    const log = await createClassLog(req.user, req.body);
    await logAction(req.user._id, 'CLASS_LOG_CREATED', 'ClassLog', log._id, {
      subject: req.body.subjectId,
      date: log.date,
      period: log.period,
      topic: log.topic,
    }, req.ip);
    return sendSuccess(res, log, 'Class log created', 201);
  } catch (err) {
    if (err.statusCode === 409) {
      return sendError(res, err.message, 409, null, { data: { existingClassLogId: err.existingClassLogId } });
    }
    return next(err);
  }
}

async function getClassLogsForSubject(req, res, next) {
  try {
    const logs = await listClassLogs(req.params.id, req.user);
    return sendSuccess(res, logs, 'Class logs retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Attendance (UC-47, UC-48) ───────────────────────────────────────────── */

async function recordAttendanceEntry(req, res, next) {
  try {
    const result = await recordAttendance(req.user, req.body);
    await logAction(req.user._id, 'ATTENDANCE_RECORDED', 'ClassLog', req.body.logId, {
      studentCount: req.body.attendance.length,
    }, req.ip);
    return sendSuccess(res, result, 'Attendance recorded', 201);
  } catch (err) {
    if (err.statusCode === 409) {
      return sendError(res, err.message, 409, null, { data: { existingClassLogId: err.existingClassLogId } });
    }
    return next(err);
  }
}

async function editAttendanceEntry(req, res, next) {
  try {
    const result = await editAttendance(req.user, req.params.logId, req.body.attendance);
    await logAction(req.user._id, 'ATTENDANCE_UPDATED', 'ClassLog', req.params.logId, {
      studentCount: req.body.attendance.length,
    }, req.ip);
    return sendSuccess(res, result, 'Attendance updated');
  } catch (err) {
    return next(err);
  }
}

async function getAttendanceSummaryStats(req, res, next) {
  try {
    const { subjectId } = req.query;
    const summary = await getAttendanceSummary(req.user, subjectId);
    return sendSuccess(res, summary, 'Attendance summary retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Attendance report (UC-49) ───────────────────────────────────────────── */

async function getAttendanceReportStats(req, res, next) {
  try {
    const { subjectId } = req.query;
    const format = (req.query.format || 'json').toLowerCase();

    if (!['json', 'csv', 'pdf'].includes(format)) {
      return sendError(res, 'format must be one of: json, csv, pdf', 400);
    }

    const report = await getAttendanceReport(req.user, { subjectId });

    const columns = [
      { label: 'Subject', value: (r) => r.subjectName },
      { label: 'Student ID', value: (r) => r.studentId },
      { label: 'Student Name', value: (r) => r.fullName },
      { label: 'Total Sessions', value: (r) => r.total },
      { label: 'Present', value: (r) => r.present },
      { label: 'Late', value: (r) => r.late },
      { label: 'Absent', value: (r) => r.absent },
      { label: 'Attendance %', value: (r) => r.percent },
      { label: 'Below Minimum', value: (r) => (r.belowMinimum ? 'YES' : 'NO') },
    ];

    if (format === 'csv') {
      return sendCsv(res, 'attendance-report.csv', report.rows, columns);
    }

    if (format === 'pdf') {
      return streamTablePdf(res, {
        title: 'Attendance Report',
        filename: 'attendance-report.pdf',
        columns,
        rows: report.rows,
      });
    }

    return sendSuccess(res, report, 'Attendance report generated');
  } catch (err) {
    return next(err);
  }
}

/* ── Internal assessment marks (UC-50, UC-51) ────────────────────────────── */

async function recordInternalMarksEntry(req, res, next) {
  try {
    const record = await recordInternalMarks(req.user, req.body);
    await logAction(req.user._id, 'INTERNAL_MARKS_RECORDED', 'InternalMark', record._id, req.body, req.ip);
    return sendSuccess(res, record, 'Internal marks recorded', 201);
  } catch (err) {
    return next(err);
  }
}

async function getStudentInternalMarks(req, res, next) {
  try {
    const { subjectId } = req.query;
    const marks = await getInternalMarks(req.params.id, req.user, subjectId);
    return sendSuccess(res, marks, 'Internal marks retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Assignments (UC-52, UC-53, UC-54) ───────────────────────────────────── */

async function createAssignmentEntry(req, res, next) {
  try {
    const assignment = await createAssignment(req.user, req.body);
    await logAction(req.user._id, 'ASSIGNMENT_CREATED', 'Assignment', assignment._id, {
      subject: req.body.subjectId,
      title: assignment.title,
      dueDate: assignment.dueDate,
    }, req.ip);
    return sendSuccess(res, assignment, 'Assignment created', 201);
  } catch (err) {
    return next(err);
  }
}

async function recordAssignmentMarksEntry(req, res, next) {
  try {
    const { marks } = req.body;
    const records = await recordAssignmentMarks(req.user, req.params.id, marks);
    await logAction(req.user._id, 'ASSIGNMENT_MARKS_RECORDED', 'Assignment', req.params.id, {
      studentCount: marks.length,
    }, req.ip);
    return sendSuccess(res, records, 'Assignment marks recorded', 201);
  } catch (err) {
    return next(err);
  }
}

async function getStudentAssignmentMarks(req, res, next) {
  try {
    const { subjectId } = req.query;
    const marks = await getAssignmentMarks(req.params.id, req.user, subjectId);
    return sendSuccess(res, marks, 'Assignment marks retrieved');
  } catch (err) {
    return next(err);
  }
}

/* ── Course progress & analytics (AL-01, AL-03) ──────────────────────────── */

async function getCourseProgress(req, res, next) {
  try {
    const progress = await getSubjectProgress(req.params.id, req.user);
    return sendSuccess(res, progress, 'Course progress retrieved');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
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
};
