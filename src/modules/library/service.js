'use strict';

const Resource = require('../../models/Resource');
const LibraryTransaction = require('../../models/LibraryTransaction');
const Booking = require('../../models/Booking');
const User = require('../../models/User');
const { notify, notifyRoles, notifyResourceManagerOrRole } = require('../../utils/notifier');

const BORROW_LIMITS = {
  STUDENT: 5,
  FACULTY: 10,
  STAFF: 5,
  LIBRARIAN: 0,
  LAB_MANAGER: 0,
  EQUIPMENT_MANAGER: 0,
  BUS_MANAGER: 0,
  ADMIN: 0,
};

const ACTIVE_STATUSES = ['ACTIVE', 'OVERDUE'];

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function addBook(data) {
  const { title, author, isbn, category, totalCopies, availableCopies, location, description } = data;

  if (!title) {
    throw httpError('title is required', 400);
  }

  const total = totalCopies !== undefined ? parseInt(totalCopies, 10) : 1;
  const available = availableCopies !== undefined ? parseInt(availableCopies, 10) : total;

  const book = await Resource.create({
    name: title,
    type: 'OTHER',
    location,
    description,
    status: available > 0 ? 'AVAILABLE' : 'BOOKED',
    totalCopies: total,
    availableCopies: Math.min(available, total),
    tags: [category, author, isbn].filter(Boolean),
    metadata: { author, isbn, category },
  });
  return book;
}

async function updateBook(bookId, data) {
  const book = await Resource.findOne({ _id: bookId, type: 'OTHER' });
  if (!book) return null;

  const { title, author, isbn, category, totalCopies, availableCopies, location, description } = data;

  const meta = book.metadata || {};
  const newMeta = {
    author: author !== undefined ? author : meta.author,
    isbn: isbn !== undefined ? isbn : meta.isbn,
    category: category !== undefined ? category : meta.category,
  };

  if (title !== undefined) book.name = title;
  if (location !== undefined) book.location = location;
  if (description !== undefined) book.description = description;
  if (totalCopies !== undefined) book.totalCopies = parseInt(totalCopies, 10);
  if (availableCopies !== undefined) book.availableCopies = parseInt(availableCopies, 10);

  book.metadata = newMeta;
  book.tags = [newMeta.category, newMeta.author, newMeta.isbn].filter(Boolean);

  await book.validate();
  await book.save();
  return book;
}

async function softDeleteBook(bookId) {
  const book = await Resource.findOneAndUpdate(
    { _id: bookId, type: 'OTHER' },
    { status: 'RETIRED' },
    { new: true }
  );
  return book;
}

async function searchBooks({ search, category, status, page = 1, limit = 20 }) {
  const query = { type: 'OTHER' };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { 'metadata.author': { $regex: search, $options: 'i' } },
      { 'metadata.isbn': { $regex: search, $options: 'i' } },
    ];
  }

  if (category) {
    query['metadata.category'] = category;
  }

  if (status) {
    query.status = status;
  } else {
    /* Hide soft-deleted books from default search results */
    query.status = { $ne: 'RETIRED' };
  }

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const skip = (pageNum - 1) * limitNum;

  const [books, total] = await Promise.all([
    Resource.find(query).skip(skip).limit(limitNum).lean(),
    Resource.countDocuments(query),
  ]);

  return {
    books,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    },
  };
}

async function getBookById(bookId) {
  const book = await Resource.findOne({ _id: bookId, type: 'OTHER' }).lean();
  if (!book) return null;

  const activeBorrows = await LibraryTransaction.countDocuments({
    book: bookId,
    status: { $in: ACTIVE_STATUSES },
  });

  return {
    ...book,
    activeBorrows,
  };
}

async function borrowBook(userId, bookId, processedBy = null, dueDate = null) {
  const book = await Resource.findOne({ _id: bookId, type: 'OTHER' });
  if (!book) throw httpError('Book not found', 404);
  if (book.status === 'RETIRED') throw httpError('Book is retired', 400);
  if ((book.availableCopies || 0) <= 0) throw httpError('No copies available', 409);

  const borrower = await User.findById(userId);
  if (!borrower) throw httpError('User not found', 404);
  if (borrower.libraryAccess === 'BLOCKED') {
    throw httpError('You are blocked from library access. Contact the library for details.', 403);
  }

  const limit = BORROW_LIMITS[borrower.role] || 0;
  if (limit > 0) {
    const userActiveBorrows = await LibraryTransaction.countDocuments({
      user: userId,
      status: { $in: ACTIVE_STATUSES },
    });
    if (userActiveBorrows >= limit) {
      throw httpError(`Borrow limit reached (${limit} items)`, 400);
    }
  }

  let due;
  if (dueDate) {
    due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) throw httpError('dueDate must be a valid date', 400);
    if (due <= new Date()) throw httpError('dueDate must be in the future', 400);
  } else {
    due = new Date();
    due.setDate(due.getDate() + 14); // 14-day default loan period
  }

  const transaction = await LibraryTransaction.create({
    user: userId,
    book: bookId,
    dueDate: due,
    processedBy,
  });

  book.availableCopies = Math.max(0, (book.availableCopies || 0) - 1);
  if (book.availableCopies === 0 && book.status === 'AVAILABLE') {
    book.status = 'BOOKED';
  }
  await book.save();

  return transaction;
}

/* ── Borrow request & approval flow ──────────────────────────────────────── */

/** Notifies the book's manager (or every LIBRARIAN/ADMIN) that a request is pending approval. */
async function notifyLibrarian(booking) {
  const [resource, requester] = await Promise.all([
    Resource.findById(booking.resource).select('name managedBy'),
    User.findById(booking.createdBy).select('fullName'),
  ]);

  await notifyResourceManagerOrRole(resource, ['LIBRARIAN'], {
    title: 'New book borrow request',
    message: `${requester?.fullName ?? 'A user'} requested to borrow "${resource?.name ?? 'a book'}" — pending your approval.`,
    type: 'LIBRARY_REQUEST_PENDING',
    entityType: 'Booking',
    entityId: booking._id,
  });
}

/**
 * Records a student/faculty/staff request to borrow a book: when they plan to
 * come collect it, the last date they can still come collect it, and why they
 * need it. Creates a PENDING Booking for the librarian to review — no copy is
 * reserved until the request is approved.
 */
async function requestBorrow(bookId, userId, { pickupDate, pickupDeadline, purpose }) {
  if (!pickupDate || !pickupDeadline) throw httpError('pickupDate and pickupDeadline are required', 400);
  if (!purpose) throw httpError('purpose is required', 400);

  const pickup = new Date(pickupDate);
  const deadline = new Date(pickupDeadline);
  if (Number.isNaN(pickup.getTime()) || Number.isNaN(deadline.getTime())) {
    throw httpError('pickupDate and pickupDeadline must be valid dates', 400);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (pickup < today) throw httpError('pickupDate cannot be in the past', 400);
  if (deadline < pickup) throw httpError('pickupDeadline must be on or after pickupDate', 400);

  const book = await Resource.findOne({ _id: bookId, type: 'OTHER' });
  if (!book) throw httpError('Book not found', 404);
  if (book.status === 'RETIRED') throw httpError('Book is retired', 400);

  const requester = await User.findById(userId);
  if (!requester) throw httpError('User not found', 404);
  if (requester.libraryAccess === 'BLOCKED') {
    throw httpError('You are blocked from library access. Contact the library for details.', 403);
  }

  const limit = BORROW_LIMITS[requester.role] || 0;
  if (limit > 0) {
    const activeCount = await LibraryTransaction.countDocuments({
      user: userId,
      status: { $in: ACTIVE_STATUSES },
    });
    if (activeCount >= limit) {
      throw httpError(`Borrow limit reached (${limit} items)`, 400);
    }
  }

  return Booking.create({
    resource: bookId,
    createdBy: userId,
    startTime: pickup,
    endTime: deadline,
    purpose,
    status: 'PENDING',
  });
}

async function getBookBookingOrThrow(bookingId) {
  const booking = await Booking.findById(bookingId).populate('resource');
  if (!booking || !booking.resource || booking.resource.type !== 'OTHER') {
    throw httpError('Book request not found', 404);
  }
  return booking;
}

/**
 * Librarian/Admin: approves a PENDING borrow request. This performs the same
 * availability/limit checks and bookkeeping as an immediate borrow, since
 * approval happens at the moment the book is actually handed over.
 */
async function approveBorrowRequest(bookingId, approverId, dueDate = null) {
  const booking = await getBookBookingOrThrow(bookingId);
  if (booking.status !== 'PENDING') {
    throw httpError(`Cannot approve a request with status ${booking.status}`, 400);
  }

  const transaction = await borrowBook(booking.createdBy, booking.resource._id, approverId, dueDate);

  booking.status = 'COMPLETED';
  booking.approvedBy = approverId;
  await booking.save();

  await notify(booking.createdBy, {
    title: 'Book request approved',
    message: `Your request for "${booking.resource.name}" has been approved. Please collect it by ${booking.endTime.toDateString()}.`,
    type: 'LIBRARY_REQUEST_APPROVED',
    entityType: 'LibraryTransaction',
    entityId: transaction._id,
  });

  return { booking, transaction };
}

/**
 * Librarian/Admin: rejects a PENDING borrow request with a required reason.
 */
async function rejectBorrowRequest(bookingId, approverId, reason) {
  const booking = await getBookBookingOrThrow(bookingId);
  if (booking.status !== 'PENDING') {
    throw httpError(`Cannot reject a request with status ${booking.status}`, 400);
  }
  booking.status = 'REJECTED';
  booking.approvedBy = approverId;
  booking.notes = reason;
  await booking.save();

  await notify(booking.createdBy, {
    title: 'Book request rejected',
    message: `Your request for "${booking.resource.name}" was rejected: ${reason}`,
    type: 'LIBRARY_REQUEST_REJECTED',
    entityType: 'Booking',
    entityId: booking._id,
  });

  return booking;
}

/**
 * Returns the logged-in user's own book requests and their statuses.
 */
async function getMyBookRequests(userId) {
  const bookings = await Booking.find({ createdBy: userId })
    .populate('resource', 'name type location')
    .sort({ createdAt: -1 })
    .lean();

  return bookings.filter((b) => b.resource && b.resource.type === 'OTHER');
}

async function returnBook(transactionId, conditionAtReturn, processedBy) {
  const transaction = await LibraryTransaction.findById(transactionId);
  if (!transaction) throw httpError('Transaction not found', 404);
  if (transaction.status === 'RETURNED') throw httpError('Book already returned', 400);

  transaction.status = 'RETURNED';
  transaction.returnDate = new Date();
  transaction.conditionAtReturn = conditionAtReturn;
  if (processedBy) transaction.processedBy = processedBy;
  await transaction.save();

  const book = await Resource.findById(transaction.book);
  if (book) {
    const total = book.totalCopies || 1;
    book.availableCopies = Math.min(total, (book.availableCopies || 0) + 1);
    if (book.status === 'BOOKED' && book.availableCopies > 0) {
      book.status = 'AVAILABLE';
    }
    await book.save();
  }

  return transaction;
}

async function getUserBooks(userId) {
  const transactions = await LibraryTransaction.find({
    user: userId,
    status: { $in: [...ACTIVE_STATUSES, 'RETURN_PENDING'] },
  })
    .populate('book', 'name location metadata')
    .sort({ dueDate: 1 });

  return transactions.map((t) => ({
    transactionId: t._id,
    book: t.book,
    checkoutDate: t.checkoutDate,
    dueDate: t.dueDate,
    status: t.status,
    isOverdue: t.isOverdue(),
  }));
}

/**
 * Borrower marks a book as returned. Doesn't free up the copy yet — the
 * librarian must confirm (via the existing returnBook flow) before
 * availableCopies increments, in case the book wasn't actually brought back.
 */
async function requestReturn(transactionId, userId) {
  const transaction = await LibraryTransaction.findOne({ _id: transactionId, user: userId });
  if (!transaction) throw httpError('Transaction not found', 404);
  if (!ACTIVE_STATUSES.includes(transaction.status)) {
    throw httpError(`Cannot request a return for a transaction with status ${transaction.status}`, 400);
  }

  transaction.status = 'RETURN_PENDING';
  transaction.returnRequestedAt = new Date();
  await transaction.save();

  const [book, borrower] = await Promise.all([
    Resource.findById(transaction.book).select('name managedBy'),
    User.findById(userId).select('fullName'),
  ]);

  await notifyResourceManagerOrRole(book, ['LIBRARIAN'], {
    title: 'Book marked as returned',
    message: `${borrower?.fullName ?? 'A user'} marked "${book?.name ?? 'a book'}" as returned — pending your confirmation.`,
    type: 'LIBRARY_RETURN_PENDING',
    entityType: 'LibraryTransaction',
    entityId: transaction._id,
  });

  return transaction;
}

/**
 * Librarian/Admin view of all return requests awaiting confirmation.
 */
async function getPendingReturns() {
  const transactions = await LibraryTransaction.find({ status: 'RETURN_PENDING' })
    .populate('book', 'name location')
    .populate('user', 'fullName email')
    .sort({ returnRequestedAt: 1 })
    .lean();

  return transactions.map((t) => ({
    transactionId: t._id,
    book: t.book ? { _id: t.book._id, name: t.book.name, location: t.book.location } : null,
    user: t.user ? { _id: t.user._id, fullName: t.user.fullName, email: t.user.email } : null,
    dueDate: t.dueDate,
    returnRequestedAt: t.returnRequestedAt,
  }));
}

/**
 * Librarian/Admin: rejects a return request (the book wasn't actually
 * returned), putting the transaction back into ACTIVE/OVERDUE.
 */
async function denyReturnRequest(transactionId, librarianId, reason) {
  if (!reason) throw httpError('reason is required', 400);

  const transaction = await LibraryTransaction.findById(transactionId).populate('book', 'name');
  if (!transaction) throw httpError('Transaction not found', 404);
  if (transaction.status !== 'RETURN_PENDING') {
    throw httpError(`Cannot deny a transaction with status ${transaction.status}`, 400);
  }

  transaction.status = transaction.dueDate < new Date() ? 'OVERDUE' : 'ACTIVE';
  await transaction.save();

  await notify(transaction.user, {
    title: 'Return request denied',
    message: `Your return of "${transaction.book?.name ?? 'a book'}" was not confirmed: ${reason}`,
    type: 'LIBRARY_RETURN_DENIED',
    entityType: 'LibraryTransaction',
    entityId: transaction._id,
  });

  return transaction;
}

/**
 * Marks ACTIVE transactions past their dueDate as OVERDUE, then suspends
 * (status = BLOCKED) any user whose total OVERDUE count meets/exceeds threshold.
 */
async function processOverdueTransactions(threshold = 3) {
  const newlyOverdue = await LibraryTransaction.find({
    status: 'ACTIVE',
    dueDate: { $lt: new Date() },
  }).populate('book', 'name');

  const affectedUserIds = new Set();
  for (const tx of newlyOverdue) {
    tx.status = 'OVERDUE';
    await tx.save();
    affectedUserIds.add(tx.user.toString());
    await notify(tx.user, {
      title: 'Library item overdue',
      message: `"${tx.book?.name ?? 'A borrowed item'}" is overdue. Please return it as soon as possible — you may be blocked or refused access to the library if it is not returned on time.`,
      type: 'LIBRARY_OVERDUE',
      entityType: 'LibraryTransaction',
      entityId: tx._id,
    });
  }

  const suspendedUsers = [];
  for (const userId of affectedUserIds) {
    const totalOverdue = await LibraryTransaction.countDocuments({
      user: userId,
      status: 'OVERDUE',
    });

    if (totalOverdue >= threshold) {
      const user = await User.findById(userId);
      if (user && user.status === 'ACTIVE') {
        user.status = 'BLOCKED';
        user.isActive = false;
        await user.save();
        suspendedUsers.push(userId);
        await notify(userId, {
          title: 'Account blocked',
          message: `Your account has been blocked due to ${totalOverdue} overdue library items. Return them and contact an administrator to be unblocked.`,
          type: 'USER_BLOCKED_OVERDUE',
          entityType: 'User',
          entityId: userId,
        });
      }
    }
  }

  return {
    overdueCount: newlyOverdue.length,
    suspendedUsers,
  };
}

/**
 * Librarian/Admin dashboard summary: catalogue size, active loans, overdue
 * loans, and pending borrow requests.
 */
async function getLibraryStatsSummary() {
  const bookIds = await Resource.find({ type: 'OTHER' }).distinct('_id');

  const [totalBooks, borrowedBooks, overdueBooks, newRequests] = await Promise.all([
    Resource.countDocuments({ type: 'OTHER', status: { $ne: 'RETIRED' } }),
    LibraryTransaction.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
    LibraryTransaction.countDocuments({ status: 'OVERDUE' }),
    Booking.countDocuments({ status: 'PENDING', resource: { $in: bookIds } }),
  ]);

  return { totalBooks, borrowedBooks, overdueBooks, newRequests };
}

/**
 * Librarian/Admin dashboard: transactions currently past their due date.
 */
async function getOverdueLoansList() {
  const transactions = await LibraryTransaction.find({ status: 'OVERDUE' })
    .populate('book', 'name')
    .populate('user', 'fullName email')
    .sort({ dueDate: 1 })
    .lean();

  return transactions.map((t) => ({
    transactionId: t._id,
    book: t.book ? { _id: t.book._id, name: t.book.name } : null,
    borrower: t.user ? { _id: t.user._id, fullName: t.user.fullName, email: t.user.email } : null,
    dueDate: t.dueDate,
  }));
}

async function getBorrowTransaction(transactionId) {
  return LibraryTransaction.findById(transactionId)
    .populate('user', 'fullName email')
    .populate('book', 'name metadata')
    .populate('processedBy', 'fullName');
}

async function getCirculationReport({ from, to }) {
  const match = {
    checkoutDate: {
      $gte: new Date(from),
      $lte: new Date(to),
    },
  };

  const transactions = await LibraryTransaction.find(match)
    .populate('user', 'fullName email role')
    .populate('book', 'name metadata')
    .sort({ checkoutDate: 1 })
    .lean();

  const summary = transactions.reduce(
    (acc, t) => {
      acc.totalBorrows += 1;
      if (t.status === 'RETURNED') acc.returns += 1;
      if (t.status === 'OVERDUE') acc.overdue += 1;
      if (t.status === 'ACTIVE') acc.active += 1;
      return acc;
    },
    { totalBorrows: 0, returns: 0, overdue: 0, active: 0 }
  );

  return { summary, transactions };
}

/** Roles that actually borrow books (i.e. have a borrow limit > 0) — "users with library access". */
const BORROWER_ROLES = Object.keys(BORROW_LIMITS).filter((role) => BORROW_LIMITS[role] > 0);

/**
 * Librarian/Admin: lists borrower-role users (STUDENT/FACULTY/STAFF) with
 * their library access status and current loan counts, for the library user
 * management page. Supports optional search (name/email) and status filter.
 */
async function getLibraryUsers({ search, status } = {}) {
  const query = { role: { $in: BORROWER_ROLES } };

  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const normalizedStatus = (status || '').toUpperCase();
  if (['ACTIVE', 'BLOCKED'].includes(normalizedStatus)) {
    query.libraryAccess = normalizedStatus;
  }

  const users = await User.find(query).sort({ fullName: 1 }).lean();

  const counts = await Promise.all(
    users.map((u) =>
      Promise.all([
        LibraryTransaction.countDocuments({ user: u._id, status: { $in: ACTIVE_STATUSES } }),
        LibraryTransaction.countDocuments({ user: u._id, status: 'OVERDUE' }),
      ])
    )
  );

  return users.map((u, i) => ({
    ...u,
    activeLoans: counts[i][0],
    overdueLoans: counts[i][1],
  }));
}

/**
 * Librarian/Admin: blocks a user's library access specifically (not their
 * whole account), with a required reason. Notifies the user and broadcasts
 * to every ADMIN.
 */
async function blockLibraryAccess(userId, reason) {
  if (!reason) throw httpError('reason is required', 400);

  const user = await User.findOne({ _id: userId, role: { $in: BORROWER_ROLES } });
  if (!user) throw httpError('User not found', 404);
  if (user.libraryAccess === 'BLOCKED') throw httpError('This user is already blocked from the library', 409);

  user.libraryAccess = 'BLOCKED';
  user.libraryBlockReason = reason;
  await user.save();

  await notify(user._id, {
    title: 'Library access blocked',
    message: `You have been blocked from library access. Reason: ${reason}`,
    type: 'LIBRARY_ACCESS_BLOCKED',
    entityType: 'User',
    entityId: user._id,
  });

  await notifyRoles(['ADMIN'], {
    title: 'User blocked from library access',
    message: `${user.fullName} (${user.email}) has been blocked from library access by a librarian. Reason: ${reason}`,
    type: 'LIBRARY_ACCESS_BLOCKED',
    entityType: 'User',
    entityId: user._id,
  });

  return user;
}

/**
 * Librarian/Admin: restores a user's library access.
 */
async function unblockLibraryAccess(userId) {
  const user = await User.findOne({ _id: userId, role: { $in: BORROWER_ROLES } });
  if (!user) throw httpError('User not found', 404);
  if (user.libraryAccess !== 'BLOCKED') throw httpError('This user is not blocked from the library', 409);

  user.libraryAccess = 'ACTIVE';
  user.libraryBlockReason = undefined;
  await user.save();

  await notify(user._id, {
    title: 'Library access restored',
    message: 'Your library access has been restored.',
    type: 'LIBRARY_ACCESS_UNBLOCKED',
    entityType: 'User',
    entityId: user._id,
  });

  return user;
}

module.exports = {
  addBook,
  updateBook,
  softDeleteBook,
  searchBooks,
  getBookById,
  borrowBook,
  notifyLibrarian,
  requestBorrow,
  approveBorrowRequest,
  rejectBorrowRequest,
  getMyBookRequests,
  returnBook,
  getUserBooks,
  processOverdueTransactions,
  getBorrowTransaction,
  getCirculationReport,
  getLibraryStatsSummary,
  getOverdueLoansList,
  requestReturn,
  getPendingReturns,
  denyReturnRequest,
  getLibraryUsers,
  blockLibraryAccess,
  unblockLibraryAccess,
};
