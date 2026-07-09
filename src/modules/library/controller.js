'use strict';

const {
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
  getCirculationReport,
  getLibraryStatsSummary,
  getOverdueLoansList,
  requestReturn,
  getPendingReturns,
  denyReturnRequest,
  getLibraryUsers,
  blockLibraryAccess,
  unblockLibraryAccess,
} = require('./service');
const { sendSuccess, sendError } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');
const { sendCsv } = require('../../utils/csv');
const { streamTablePdf } = require('../../utils/pdf');

async function createBook(req, res, next) {
  try {
    const book = await addBook(req.body);
    await logAction(req.user._id, 'BOOK_CREATED', 'Resource', book._id, { name: book.name }, req.ip);
    return sendSuccess(res, book, 'Book added to catalogue', 201);
  } catch (err) {
    return next(err);
  }
}

async function updateBookEntry(req, res, next) {
  try {
    const book = await updateBook(req.params.id, req.body);
    if (!book) return sendError(res, 'Book not found', 404);

    await logAction(req.user._id, 'BOOK_UPDATED', 'Resource', book._id, { changes: req.body }, req.ip);
    return sendSuccess(res, book, 'Book updated');
  } catch (err) {
    return next(err);
  }
}

async function deleteBook(req, res, next) {
  try {
    const book = await softDeleteBook(req.params.id);
    if (!book) return sendError(res, 'Book not found', 404);

    await logAction(req.user._id, 'BOOK_RETIRED', 'Resource', book._id, { name: book.name }, req.ip);
    return sendSuccess(res, null, 'Book removed from catalogue');
  } catch (err) {
    return next(err);
  }
}

async function searchBooksList(req, res, next) {
  try {
    const { search, category, status, page, limit } = req.query;
    const result = await searchBooks({ search, category, status, page, limit });
    return sendSuccess(res, result.books, 'Books found', 200, result.pagination);
  } catch (err) {
    return next(err);
  }
}

async function getBookDetails(req, res, next) {
  try {
    const book = await getBookById(req.params.id);
    if (!book) return sendError(res, 'Book not found', 404);
    return sendSuccess(res, book);
  } catch (err) {
    return next(err);
  }
}

async function borrowBookController(req, res, next) {
  try {
    const { bookId, conditionAtCheckout, dueDate } = req.body;
    if (!bookId) return sendError(res, 'bookId is required', 400);

    const transaction = await borrowBook(req.user._id, bookId, null, dueDate);

    if (conditionAtCheckout) {
      transaction.conditionAtCheckout = conditionAtCheckout;
      await transaction.save();
    }

    await logAction(req.user._id, 'BOOK_BORROWED', 'LibraryTransaction', transaction._id, { bookId }, req.ip);
    return sendSuccess(res, transaction, 'Book borrowed successfully', 201);
  } catch (err) {
    return next(err);
  }
}

/* ── Borrow request & approval flow ──────────────────────────────────────── */

async function requestBorrowController(req, res, next) {
  try {
    const { bookId, pickupDate, pickupDeadline, purpose } = req.body;
    if (!bookId) return sendError(res, 'bookId is required', 400);

    const booking = await requestBorrow(bookId, req.user._id, { pickupDate, pickupDeadline, purpose });

    await logAction(
      req.user._id,
      'BOOK_BORROW_REQUESTED',
      'Booking',
      booking._id,
      { bookId, pickupDate: booking.startTime, pickupDeadline: booking.endTime, purpose },
      req.ip
    );

    await notifyLibrarian(booking);

    return sendSuccess(res, booking, 'Borrow request submitted and pending librarian approval', 201);
  } catch (err) {
    return next(err);
  }
}

async function approveBorrowController(req, res, next) {
  try {
    const { dueDate } = req.body;
    const { booking, transaction } = await approveBorrowRequest(req.params.id, req.user._id, dueDate);
    await logAction(
      req.user._id,
      'BOOK_BORROW_APPROVED',
      'Booking',
      booking._id,
      { transactionId: transaction._id },
      req.ip
    );
    return sendSuccess(res, { booking, transaction }, 'Borrow request approved and book checked out');
  } catch (err) {
    return next(err);
  }
}

async function rejectBorrowController(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return sendError(res, 'reason is required', 400);

    const booking = await rejectBorrowRequest(req.params.id, req.user._id, reason);
    await logAction(req.user._id, 'BOOK_BORROW_REJECTED', 'Booking', booking._id, { reason }, req.ip);
    return sendSuccess(res, booking, 'Borrow request rejected');
  } catch (err) {
    return next(err);
  }
}

async function getMyBookRequestsController(req, res, next) {
  try {
    const requests = await getMyBookRequests(req.user._id);
    return sendSuccess(res, requests, 'Your book requests');
  } catch (err) {
    return next(err);
  }
}

async function returnBookController(req, res, next) {
  try {
    const transaction = await returnBook(
      req.params.transactionId,
      req.body.conditionAtReturn,
      req.user._id
    );

    await logAction(req.user._id, 'BOOK_RETURNED', 'LibraryTransaction', transaction._id, { conditionAtReturn: req.body.conditionAtReturn }, req.ip);
    return sendSuccess(res, transaction, 'Book returned successfully');
  } catch (err) {
    return next(err);
  }
}

async function getMyBooks(req, res, next) {
  try {
    const books = await getUserBooks(req.user._id);
    return sendSuccess(res, books, 'Your borrowed books');
  } catch (err) {
    return next(err);
  }
}

/* ── Borrower-initiated return, pending librarian confirmation ───────────── */

async function requestReturnController(req, res, next) {
  try {
    const transaction = await requestReturn(req.params.transactionId, req.user._id);
    await logAction(req.user._id, 'BOOK_RETURN_REQUESTED', 'LibraryTransaction', transaction._id, {}, req.ip);
    return sendSuccess(res, transaction, 'Return marked — pending librarian confirmation');
  } catch (err) {
    return next(err);
  }
}

async function getPendingReturnsController(req, res, next) {
  try {
    const returns = await getPendingReturns();
    return sendSuccess(res, returns, 'Pending return requests');
  } catch (err) {
    return next(err);
  }
}

async function denyReturnController(req, res, next) {
  try {
    const { reason } = req.body;
    const transaction = await denyReturnRequest(req.params.transactionId, req.user._id, reason);
    await logAction(req.user._id, 'BOOK_RETURN_DENIED', 'LibraryTransaction', transaction._id, { reason }, req.ip);
    return sendSuccess(res, transaction, 'Return request denied');
  } catch (err) {
    return next(err);
  }
}

/* ── Library-specific user access management ──────────────────────────────── */

async function getLibraryUsersController(req, res, next) {
  try {
    const { search, status } = req.query;
    const users = await getLibraryUsers({ search, status });
    return sendSuccess(res, users, 'Library users retrieved');
  } catch (err) {
    return next(err);
  }
}

async function blockLibraryAccessController(req, res, next) {
  try {
    const { reason } = req.body;
    const user = await blockLibraryAccess(req.params.id, reason);
    await logAction(req.user._id, 'LIBRARY_ACCESS_BLOCKED', 'User', user._id, { email: user.email, reason }, req.ip);
    return sendSuccess(res, user, 'User blocked from library access');
  } catch (err) {
    return next(err);
  }
}

async function unblockLibraryAccessController(req, res, next) {
  try {
    const user = await unblockLibraryAccess(req.params.id);
    await logAction(req.user._id, 'LIBRARY_ACCESS_UNBLOCKED', 'User', user._id, { email: user.email }, req.ip);
    return sendSuccess(res, user, 'User\'s library access restored');
  } catch (err) {
    return next(err);
  }
}

async function getCirculationStats(req, res, next) {
  try {
    const { from, to } = req.query;
    const format = (req.query.format || 'json').toLowerCase();

    if (!from || !to) {
      return sendError(res, 'from and to query parameters required', 400);
    }

    if (!['json', 'csv', 'pdf', 'excel'].includes(format)) {
      return sendError(res, 'format must be one of: json, csv, pdf, excel', 400);
    }

    if (format === 'excel') {
      return sendError(res, `Report format '${format}' is not yet implemented`, 501);
    }

    const { summary, transactions } = await getCirculationReport({ from, to });

    const columns = [
      { label: 'Transaction ID', value: (t) => t._id },
      { label: 'Book', value: (t) => t.book?.name || '' },
      { label: 'Borrower', value: (t) => t.user?.fullName || '' },
      { label: 'Borrower Email', value: (t) => t.user?.email || '' },
      { label: 'Checkout Date', value: (t) => t.checkoutDate?.toISOString() || '' },
      { label: 'Due Date', value: (t) => t.dueDate?.toISOString() || '' },
      { label: 'Return Date', value: (t) => t.returnDate?.toISOString() || '' },
      { label: 'Status', value: (t) => t.status },
    ];

    if (format === 'csv') {
      return sendCsv(res, `circulation-report-${from}-to-${to}.csv`, transactions, columns);
    }

    if (format === 'pdf') {
      return streamTablePdf(res, {
        title: 'Library Circulation Report',
        subtitle: `Period: ${from} to ${to}`,
        filename: `circulation-report-${from}-to-${to}.pdf`,
        columns,
        rows: transactions,
      });
    }

    return sendSuccess(res, { summary, transactions }, 'Circulation report generated');
  } catch (err) {
    return next(err);
  }
}

async function getLibrarySummary(req, res, next) {
  try {
    const summary = await getLibraryStatsSummary();
    return sendSuccess(res, summary, 'Library summary');
  } catch (err) {
    return next(err);
  }
}

async function getOverdueLoansController(req, res, next) {
  try {
    const loans = await getOverdueLoansList();
    return sendSuccess(res, loans, 'Overdue loans');
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createBook,
  updateBookEntry,
  deleteBook,
  searchBooksList,
  getBookDetails,
  borrowBookController,
  requestBorrowController,
  approveBorrowController,
  rejectBorrowController,
  getMyBookRequestsController,
  returnBookController,
  getMyBooks,
  getCirculationStats,
  getLibrarySummary,
  getOverdueLoansController,
  requestReturnController,
  getPendingReturnsController,
  denyReturnController,
  getLibraryUsersController,
  blockLibraryAccessController,
  unblockLibraryAccessController,
};