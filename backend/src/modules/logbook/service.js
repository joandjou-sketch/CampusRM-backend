'use strict';

const Subject = require('../../models/Subject');
const Enrollment = require('../../models/Enrollment');
const ClassLog = require('../../models/ClassLog');
const Attendance = require('../../models/Attendance');
const Assignment = require('../../models/Assignment');
const AssignmentMark = require('../../models/AssignmentMark');
const InternalMark = require('../../models/InternalMark');
const User = require('../../models/User');
const { notify } = require('../../utils/notifier');

const MANAGER_ROLES = ['ADMIN'];
const LATE_WEIGHT = 0.5;
const MIN_ATTENDANCE_PERCENT = Number(process.env.MIN_ATTENDANCE_PERCENT) || 75;

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isManager(role) {
  return MANAGER_ROLES.includes(role);
}

/* ── Notifications ────────────────────────────────────────────────────── */

async function notifyMarksPublished(studentId, context) {
  const label = context.type === 'ASSIGNMENT_MARK' ? 'assignment' : 'internal assessment';
  await notify(studentId, {
    title: 'New marks published',
    message: `Your ${label} marks have been recorded: ${context.marks}/${context.maxMarks}.`,
    type: context.type,
    entityType: context.type === 'ASSIGNMENT_MARK' ? 'Assignment' : 'InternalMark',
    entityId: context.assignmentId ?? context.subjectId,
  });
}

async function notifyLowAttendance(studentId, subjectId, percent) {
  await notify(studentId, {
    title: 'Low attendance warning',
    message: `Your attendance has dropped to ${percent}%, below the required ${MIN_ATTENDANCE_PERCENT}%.`,
    type: 'LOW_ATTENDANCE',
    entityType: 'Subject',
    entityId: subjectId,
  });
}

/* ── Subject & Enrollment management ─────────────────────────────────────
 * Not explicitly listed as endpoints in the module brief, but required so
 * the rest of the module (class logs, attendance, marks) has data to act on.
 * Administrators set up Subjects and assign Faculty; Faculty/Admin enroll
 * Students. ────────────────────────────────────────────────────────────── */

async function createSubject({ name, code, facultyId, level, program, totalPlannedSessions }) {
  if (!name) throw httpError('name is required', 400);
  if (!facultyId) throw httpError('facultyId is required', 400);

  const faculty = await User.findById(facultyId).lean();
  if (!faculty || faculty.role !== 'FACULTY') {
    throw httpError('facultyId must reference a user with role FACULTY', 400);
  }

  return Subject.create({
    name,
    code,
    faculty: facultyId,
    level,
    program,
    totalPlannedSessions: totalPlannedSessions || 0,
  });
}

/**
 * Lists subjects visible to the requesting user: Faculty see their own,
 * Students see subjects they're enrolled in, Resource Manager/Admin see all.
 */
async function listSubjects(user) {
  if (user.role === 'FACULTY') {
    return Subject.find({ faculty: user._id }).lean();
  }

  if (user.role === 'STUDENT') {
    const enrollments = await Enrollment.find({ student: user._id }).select('subject').lean();
    const subjectIds = enrollments.map((e) => e.subject);
    return Subject.find({ _id: { $in: subjectIds } }).lean();
  }

  if (isManager(user.role)) {
    return Subject.find({}).populate('faculty', 'fullName email').lean();
  }

  return [];
}

async function getSubjectOrThrow(subjectId) {
  const subject = await Subject.findById(subjectId);
  if (!subject) throw httpError('Subject not found', 404);
  return subject;
}

function assertFacultyOwnerOrManager(subject, user) {
  const isOwner = subject.faculty.toString() === user._id.toString();
  if (!isOwner && !isManager(user.role)) {
    throw httpError('You are not authorized to manage this subject', 403);
  }
}

/**
 * Faculty owner or Admin can update subject metadata, including the
 * planned-session count used for the AL-01 progress calculation.
 */
async function updateSubject(subjectId, user, updates) {
  const subject = await getSubjectOrThrow(subjectId);

  const isOwner = subject.faculty.toString() === user._id.toString();
  if (!isOwner && user.role !== 'ADMIN') {
    throw httpError('You are not authorized to update this subject', 403);
  }

  const { name, code, level, program, totalPlannedSessions, isActive } = updates;
  if (name !== undefined) subject.name = name;
  if (code !== undefined) subject.code = code;
  if (level !== undefined) subject.level = level;
  if (program !== undefined) subject.program = program;
  if (totalPlannedSessions !== undefined) {
    if (totalPlannedSessions < 0) throw httpError('totalPlannedSessions cannot be negative', 400);
    subject.totalPlannedSessions = totalPlannedSessions;
  }
  if (isActive !== undefined) subject.isActive = isActive;

  await subject.save();
  return subject;
}

/**
 * Enrolls a student in a subject. Faculty owner or Admin only.
 */
async function enrollStudent(subjectId, user, studentId) {
  if (!studentId) throw httpError('studentId is required', 400);

  const subject = await getSubjectOrThrow(subjectId);
  const isOwner = subject.faculty.toString() === user._id.toString();
  if (!isOwner && user.role !== 'ADMIN') {
    throw httpError('You are not authorized to manage enrollment for this subject', 403);
  }

  const student = await User.findById(studentId).lean();
  if (!student || student.role !== 'STUDENT') {
    throw httpError('studentId must reference a user with role STUDENT', 400);
  }

  try {
    return await Enrollment.create({ student: studentId, subject: subjectId });
  } catch (err) {
    if (err.code === 11000) throw httpError('Student is already enrolled in this subject', 409);
    throw err;
  }
}

/**
 * Lists students enrolled in a subject. Faculty owner, Resource Manager/HoD, or Admin.
 */
async function listEnrolledStudents(subjectId, user) {
  const subject = await getSubjectOrThrow(subjectId);
  assertFacultyOwnerOrManager(subject, user);

  const enrollments = await Enrollment.find({ subject: subjectId })
    .populate('student', 'fullName email role')
    .lean();

  return enrollments.map((e) => e.student);
}

async function getEnrolledStudentIds(subjectId) {
  const enrollments = await Enrollment.find({ subject: subjectId }).select('student').lean();
  return enrollments.map((e) => e.student.toString());
}

async function assertEnrolled(subjectId, studentId) {
  const enrolled = await Enrollment.exists({ subject: subjectId, student: studentId });
  if (!enrolled) throw httpError('Student is not enrolled in this subject', 403);
}

/* ── Class logs (AL-02, UC-47 duplicate-session guard) ───────────────────── */

/**
 * Faculty creates a class-log entry for one teaching session. The unique
 * index on {subject, date, period} enforces the duplicate-session guard:
 * a repeat create returns a 409 pointing the caller at the existing log.
 */
async function createClassLog(user, { subjectId, date, period, topic, lessonConducted }) {
  if (!subjectId || !date || !period || !topic) {
    throw httpError('subjectId, date, period and topic are required', 400);
  }

  const subject = await getSubjectOrThrow(subjectId);
  if (subject.faculty.toString() !== user._id.toString()) {
    throw httpError('You may only create class logs for your own subjects', 403);
  }

  const sessionDate = new Date(date);
  if (Number.isNaN(sessionDate.getTime())) throw httpError('date must be a valid date', 400);

  try {
    return await ClassLog.create({
      subject: subjectId,
      faculty: user._id,
      date: sessionDate,
      period,
      topic,
      lessonConducted,
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await ClassLog.findOne({ subject: subjectId, date: sessionDate, period });
      const dupErr = httpError(
        'A class log already exists for this subject/date/period. Edit the existing record instead.',
        409
      );
      dupErr.existingClassLogId = existing && existing._id;
      throw dupErr;
    }
    throw err;
  }
}

/**
 * Lists topics covered for a subject. Visible to the owning Faculty, any
 * enrolled Student, and Resource Manager/Admin.
 */
async function listClassLogs(subjectId, user) {
  const subject = await getSubjectOrThrow(subjectId);

  if (user.role === 'STUDENT') {
    await assertEnrolled(subjectId, user._id);
  } else if (user.role === 'FACULTY') {
    if (subject.faculty.toString() !== user._id.toString()) {
      throw httpError('You may only view class logs for your own subjects', 403);
    }
  } else if (!isManager(user.role)) {
    throw httpError('You are not authorized to view this subject', 403);
  }

  return ClassLog.find({ subject: subjectId }).sort({ date: 1, period: 1 }).lean();
}

async function getClassLogOrThrow(logId) {
  const log = await ClassLog.findById(logId);
  if (!log) throw httpError('Class log not found', 404);
  return log;
}

/* ── Attendance (UC-47, UC-48, UC-49) ────────────────────────────────────── */

/**
 * Computes attendance stats from a set of Attendance rows. LATE sessions
 * count as a configurable fraction of a PRESENT session (default 0.5).
 */
function computeAttendanceStats(records) {
  const total = records.length;
  const present = records.filter((r) => r.status === 'PRESENT').length;
  const late = records.filter((r) => r.status === 'LATE').length;
  const absent = records.filter((r) => r.status === 'ABSENT').length;
  const weighted = present + late * LATE_WEIGHT;
  const percent = total > 0 ? (weighted / total) * 100 : 0;
  return { total, present, late, absent, percent: round2(percent) };
}

/**
 * Validates an attendance roster against the subject's enrolled students:
 * every enrolled student must appear exactly once, with no extras.
 */
function validateRoster(enrolledIds, attendance) {
  if (!Array.isArray(attendance) || attendance.length === 0) {
    throw httpError('attendance must be a non-empty array', 400);
  }
  if (attendance.length !== enrolledIds.length) {
    throw httpError(
      `attendance count (${attendance.length}) does not match enrolled student count (${enrolledIds.length})`,
      400
    );
  }

  const enrolledSet = new Set(enrolledIds);
  const seen = new Set();
  for (const row of attendance) {
    if (!row.studentId || !row.status) {
      throw httpError('Each attendance row requires studentId and status', 400);
    }
    if (!['PRESENT', 'ABSENT', 'LATE'].includes(row.status)) {
      throw httpError(`Invalid attendance status: ${row.status}`, 400);
    }
    if (!enrolledSet.has(row.studentId.toString())) {
      throw httpError(`Student ${row.studentId} is not enrolled in this subject`, 400);
    }
    if (seen.has(row.studentId.toString())) {
      throw httpError(`Student ${row.studentId} appears more than once in attendance`, 400);
    }
    seen.add(row.studentId.toString());
  }
}

/**
 * Records attendance for a session. Recomputes and returns each affected
 * student's running attendance percentage, and notifies students whose
 * percentage falls below the configured minimum.
 */
async function recordAttendance(user, { logId, attendance }) {
  if (!logId) throw httpError('logId is required', 400);

  const log = await getClassLogOrThrow(logId);
  if (log.faculty.toString() !== user._id.toString()) {
    throw httpError('You may only record attendance for your own class logs', 403);
  }

  const existing = await Attendance.exists({ classLog: logId });
  if (existing) {
    const err = httpError(
      'Attendance for this session has already been recorded. Use PUT /logbook/attendance/:logId to edit it.',
      409
    );
    err.existingClassLogId = logId;
    throw err;
  }

  const enrolledIds = await getEnrolledStudentIds(log.subject);
  validateRoster(enrolledIds, attendance);

  await Attendance.insertMany(
    attendance.map((row) => ({ student: row.studentId, classLog: logId, status: row.status }))
  );

  return finalizeAttendance(log.subject, attendance.map((r) => r.studentId));
}

/**
 * Edits an existing session's attendance (faculty owner only). Replaces all
 * rows for the session, recomputes percentages, and notifies as above.
 */
async function editAttendance(user, logId, attendance) {
  const log = await getClassLogOrThrow(logId);
  if (log.faculty.toString() !== user._id.toString()) {
    throw httpError('You may only edit attendance for your own class logs', 403);
  }

  const enrolledIds = await getEnrolledStudentIds(log.subject);
  validateRoster(enrolledIds, attendance);

  await Attendance.deleteMany({ classLog: logId });
  await Attendance.insertMany(
    attendance.map((row) => ({ student: row.studentId, classLog: logId, status: row.status }))
  );

  return finalizeAttendance(log.subject, attendance.map((r) => r.studentId));
}

/**
 * Recomputes attendance percentage for each given student in a subject and
 * fires the low-attendance notification where applicable.
 */
async function finalizeAttendance(subjectId, studentIds) {
  const results = await Promise.all(
    studentIds.map(async (studentId) => {
      const records = await Attendance.find({ student: studentId })
        .populate({ path: 'classLog', match: { subject: subjectId }, select: 'subject' })
        .lean();
      const subjectRecords = records.filter((r) => r.classLog);
      const stats = computeAttendanceStats(subjectRecords);

      if (stats.percent < MIN_ATTENDANCE_PERCENT) {
        await notifyLowAttendance(studentId, subjectId, stats.percent);
      }

      return { studentId, ...stats };
    })
  );

  return { subject: subjectId, students: results };
}

/**
 * Attendance summary: a Student sees their own percentage (optionally
 * filtered to one subject); Faculty see every enrolled student's percentage
 * for their own subject.
 */
async function getAttendanceSummary(user, subjectId) {
  if (user.role === 'STUDENT') {
    const subjects = subjectId
      ? [await getSubjectOrThrow(subjectId)]
      : await Subject.find({ _id: { $in: (await Enrollment.find({ student: user._id }).select('subject').lean()).map((e) => e.subject) } }).lean();

    if (subjectId) await assertEnrolled(subjectId, user._id);

    return Promise.all(
      subjects.map(async (subject) => {
        const records = await Attendance.find({ student: user._id })
          .populate({ path: 'classLog', match: { subject: subject._id }, select: 'subject' })
          .lean();
        const subjectRecords = records.filter((r) => r.classLog);
        return { subject: subject._id, subjectName: subject.name, ...computeAttendanceStats(subjectRecords) };
      })
    );
  }

  if (user.role === 'FACULTY') {
    if (!subjectId) throw httpError('subjectId is required', 400);
    const subject = await getSubjectOrThrow(subjectId);
    if (subject.faculty.toString() !== user._id.toString()) {
      throw httpError('You may only view attendance for your own subjects', 403);
    }
    return attendanceForAllStudents(subjectId);
  }

  if (isManager(user.role)) {
    if (!subjectId) throw httpError('subjectId is required', 400);
    return attendanceForAllStudents(subjectId);
  }

  throw httpError('You are not authorized to view attendance summaries', 403);
}

async function attendanceForAllStudents(subjectId) {
  const enrolledIds = await getEnrolledStudentIds(subjectId);
  const students = await User.find({ _id: { $in: enrolledIds } }).select('fullName email').lean();

  return Promise.all(
    students.map(async (student) => {
      const records = await Attendance.find({ student: student._id })
        .populate({ path: 'classLog', match: { subject: subjectId }, select: 'subject' })
        .lean();
      const subjectRecords = records.filter((r) => r.classLog);
      return {
        studentId: student._id,
        fullName: student.fullName,
        email: student.email,
        ...computeAttendanceStats(subjectRecords),
      };
    })
  );
}

/* ── Attendance report (UC-49) ───────────────────────────────────────────── */

/**
 * Generates an attendance report across one subject (Faculty) or every
 * subject (Resource Manager/HoD, Admin), flagging students below the
 * configured minimum attendance percentage.
 */
async function getAttendanceReport(user, { subjectId }) {
  let subjects;
  if (subjectId) {
    const subject = await getSubjectOrThrow(subjectId);
    if (user.role === 'FACULTY' && subject.faculty.toString() !== user._id.toString()) {
      throw httpError('You may only generate reports for your own subjects', 403);
    }
    if (user.role === 'STUDENT') throw httpError('Students cannot generate attendance reports', 403);
    subjects = [subject];
  } else {
    if (user.role === 'FACULTY') {
      subjects = await Subject.find({ faculty: user._id }).lean();
    } else if (isManager(user.role)) {
      subjects = await Subject.find({}).lean();
    } else {
      throw httpError('subjectId is required', 400);
    }
  }

  const rows = [];
  for (const subject of subjects) {
    const studentStats = await attendanceForAllStudents(subject._id);
    for (const stat of studentStats) {
      rows.push({
        subjectId: subject._id,
        subjectName: subject.name,
        ...stat,
        belowMinimum: stat.percent < MIN_ATTENDANCE_PERCENT,
      });
    }
  }

  return { minAttendancePercent: MIN_ATTENDANCE_PERCENT, rows };
}

/* ── Internal assessment marks (UC-50, UC-51) ────────────────────────────── */

/**
 * Faculty records (or updates) a student's internal-assessment marks for one
 * component of a subject. Returns the row plus the recomputed total.
 */
async function recordInternalMarks(user, { studentId, subjectId, component, marks, maxMarks }) {
  if (!studentId || !subjectId || !component || marks == null || maxMarks == null) {
    throw httpError('studentId, subjectId, component, marks and maxMarks are required', 400);
  }
  if (!['QUIZ', 'MIDTERM', 'CA'].includes(component)) {
    throw httpError(`Invalid component: ${component}`, 400);
  }
  if (marks > maxMarks) throw httpError('marks cannot exceed maxMarks', 400);
  if (marks < 0 || maxMarks < 0) throw httpError('marks and maxMarks cannot be negative', 400);

  const subject = await getSubjectOrThrow(subjectId);
  if (subject.faculty.toString() !== user._id.toString()) {
    throw httpError('You may only record marks for your own subjects', 403);
  }
  await assertEnrolled(subjectId, studentId);

  const record = await InternalMark.findOneAndUpdate(
    { student: studentId, subject: subjectId, component },
    { marks, maxMarks, recordedBy: user._id },
    { new: true, upsert: true }
  );

  await notifyMarksPublished(studentId, { type: 'INTERNAL_MARK', subjectId, component, marks, maxMarks });

  return record;
}

/**
 * Returns a student's internal marks with component-wise breakdown and totals
 * for a subject (or every subject the student is enrolled in).
 */
async function getInternalMarks(studentId, requester, subjectId) {
  if (requester.role === 'STUDENT') {
    if (requester._id.toString() !== studentId.toString()) {
      throw httpError('You may only view your own internal marks', 403);
    }
  } else if (requester.role === 'FACULTY') {
    if (!subjectId) throw httpError('subjectId is required', 400);
    const subject = await getSubjectOrThrow(subjectId);
    if (subject.faculty.toString() !== requester._id.toString()) {
      throw httpError('You may only view marks for your own subjects', 403);
    }
  } else if (!isManager(requester.role)) {
    throw httpError('You are not authorized to view these marks', 403);
  }

  const query = { student: studentId };
  if (subjectId) query.subject = subjectId;

  const marks = await InternalMark.find(query).populate('subject', 'name').lean();

  const bySubject = new Map();
  for (const mark of marks) {
    const key = mark.subject._id.toString();
    if (!bySubject.has(key)) {
      bySubject.set(key, { subjectId: mark.subject._id, subjectName: mark.subject.name, components: [], total: 0, maxTotal: 0 });
    }
    const entry = bySubject.get(key);
    entry.components.push({ component: mark.component, marks: mark.marks, maxMarks: mark.maxMarks });
    entry.total += mark.marks;
    entry.maxTotal += mark.maxMarks;
  }

  return [...bySubject.values()];
}

/* ── Assignments (UC-52, UC-53, UC-54) ───────────────────────────────────── */

/**
 * Faculty creates an assignment for one of their subjects. Rejects due dates
 * in the past, per the module's validation rules.
 */
async function createAssignment(user, { subjectId, title, description, dueDate, maxMarks }) {
  if (!subjectId || !title || !dueDate || maxMarks == null) {
    throw httpError('subjectId, title, dueDate and maxMarks are required', 400);
  }
  if (maxMarks < 0) throw httpError('maxMarks cannot be negative', 400);

  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) throw httpError('dueDate must be a valid date', 400);
  if (due < new Date()) throw httpError('dueDate cannot be in the past', 400);

  const subject = await getSubjectOrThrow(subjectId);
  if (subject.faculty.toString() !== user._id.toString()) {
    throw httpError('You may only create assignments for your own subjects', 403);
  }

  return Assignment.create({
    subject: subjectId,
    title,
    description,
    dueDate: due,
    maxMarks,
    createdBy: user._id,
  });
}

async function getAssignmentOrThrow(assignmentId) {
  const assignment = await Assignment.findById(assignmentId);
  if (!assignment) throw httpError('Assignment not found', 404);
  return assignment;
}

/**
 * Faculty records each enrolled student's mark for an assignment. Rejects
 * marks greater than the assignment's maxMarks.
 */
async function recordAssignmentMarks(user, assignmentId, marksList) {
  if (!Array.isArray(marksList) || marksList.length === 0) {
    throw httpError('marks must be a non-empty array of { studentId, marks }', 400);
  }

  const assignment = await getAssignmentOrThrow(assignmentId);
  const subject = await getSubjectOrThrow(assignment.subject);
  if (subject.faculty.toString() !== user._id.toString()) {
    throw httpError('You may only record marks for your own subjects', 403);
  }

  const enrolledIds = new Set(await getEnrolledStudentIds(assignment.subject));

  for (const row of marksList) {
    if (!row.studentId || row.marks == null) {
      throw httpError('Each row requires studentId and marks', 400);
    }
    if (row.marks < 0 || row.marks > assignment.maxMarks) {
      throw httpError(`marks for student ${row.studentId} must be between 0 and ${assignment.maxMarks}`, 400);
    }
    if (!enrolledIds.has(row.studentId.toString())) {
      throw httpError(`Student ${row.studentId} is not enrolled in this subject`, 400);
    }
  }

  const results = [];
  for (const row of marksList) {
    const record = await AssignmentMark.findOneAndUpdate(
      { assignment: assignmentId, student: row.studentId },
      { marks: row.marks, submittedAt: new Date() },
      { new: true, upsert: true }
    );
    await notifyMarksPublished(row.studentId, { type: 'ASSIGNMENT_MARK', assignmentId, marks: row.marks, maxMarks: assignment.maxMarks });
    results.push(record);
  }

  return results;
}

/**
 * Returns a student's assignment marks for a subject, each with the class
 * average for comparison (UC-54).
 */
async function getAssignmentMarks(studentId, requester, subjectId) {
  if (requester.role === 'STUDENT') {
    if (requester._id.toString() !== studentId.toString()) {
      throw httpError('You may only view your own assignment marks', 403);
    }
  } else if (requester.role === 'FACULTY') {
    if (!subjectId) throw httpError('subjectId is required', 400);
    const subject = await getSubjectOrThrow(subjectId);
    if (subject.faculty.toString() !== requester._id.toString()) {
      throw httpError('You may only view marks for your own subjects', 403);
    }
  } else if (!isManager(requester.role)) {
    throw httpError('You are not authorized to view these marks', 403);
  }

  const assignmentQuery = subjectId ? { subject: subjectId } : {};
  const assignments = await Assignment.find(assignmentQuery).lean();

  return Promise.all(
    assignments.map(async (assignment) => {
      const [own, all] = await Promise.all([
        AssignmentMark.findOne({ assignment: assignment._id, student: studentId }).lean(),
        AssignmentMark.find({ assignment: assignment._id }).select('marks').lean(),
      ]);

      const classAverage = all.length ? round2(all.reduce((sum, m) => sum + m.marks, 0) / all.length) : null;

      return {
        assignmentId: assignment._id,
        title: assignment.title,
        dueDate: assignment.dueDate,
        maxMarks: assignment.maxMarks,
        marks: own ? own.marks : null,
        submittedAt: own ? own.submittedAt : null,
        classAverage,
      };
    })
  );
}

/* ── Course progress & analytics (AL-01, AL-03) ──────────────────────────── */

/**
 * Returns topics-covered-vs-planned progress, an attendance trend, and a
 * marks breakdown for a subject. Students see their own standing plus the
 * class average; Faculty/Resource Manager/Admin see class-wide aggregates.
 */
async function getSubjectProgress(subjectId, user) {
  const subject = await getSubjectOrThrow(subjectId);

  let targetStudentId = null;
  if (user.role === 'STUDENT') {
    await assertEnrolled(subjectId, user._id);
    targetStudentId = user._id;
  } else if (user.role === 'FACULTY') {
    if (subject.faculty.toString() !== user._id.toString()) {
      throw httpError('You may only view progress for your own subjects', 403);
    }
  } else if (!isManager(user.role)) {
    throw httpError('You are not authorized to view this subject', 403);
  }

  const topicsCovered = await ClassLog.countDocuments({ subject: subjectId });
  const percentComplete = subject.totalPlannedSessions > 0
    ? round2((topicsCovered / subject.totalPlannedSessions) * 100)
    : null;

  const classAttendance = await attendanceForAllStudents(subjectId);
  const classAverageAttendance = classAttendance.length
    ? round2(classAttendance.reduce((sum, s) => sum + s.percent, 0) / classAttendance.length)
    : 0;

  const result = {
    subject: { id: subject._id, name: subject.name, totalPlannedSessions: subject.totalPlannedSessions },
    topicsCovered,
    percentComplete,
    classAverageAttendance,
  };

  if (targetStudentId) {
    const own = classAttendance.find((s) => s.studentId.toString() === targetStudentId.toString());
    result.myAttendance = own ? { ...own } : computeAttendanceStats([]);

    const [internal, assignments] = await Promise.all([
      getInternalMarks(targetStudentId, user, subjectId),
      getAssignmentMarks(targetStudentId, user, subjectId),
    ]);
    result.internalMarks = internal[0] || null;
    result.assignmentMarks = assignments;
  } else {
    result.classAttendance = classAttendance;
  }

  return result;
}

module.exports = {
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
  MIN_ATTENDANCE_PERCENT,
};
