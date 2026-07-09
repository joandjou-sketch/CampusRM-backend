'use strict';

const express = require('express');
const router = express.Router();

const {
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
} = require('./controller');

const { authenticate, authorize } = require('../shared');

/* ── Book catalogue (librarian only — ADMIN has view-only access to the library) ── */
router.post('/books', authenticate, authorize('LIBRARIAN'), createBook);
router.put('/books/:id', authenticate, authorize('LIBRARIAN'), updateBookEntry);
router.delete('/books/:id', authenticate, authorize('LIBRARIAN'), deleteBook);

/* ── Search & availability (all authenticated users) ────────────────────────── */
router.get('/books', authenticate, searchBooksList);
router.get('/books/:id', authenticate, getBookDetails);

/* ── Borrow request & approval flow (librarian reviews before handover) ─────── */
router.post('/books/:id/request', authenticate, (req, res, next) => {
  req.body.bookId = req.params.id;
  return requestBorrowController(req, res, next);
});
router.get('/requests/me', authenticate, getMyBookRequestsController);
router.put('/requests/:id/approve', authenticate, authorize('LIBRARIAN'), approveBorrowController);
router.put('/requests/:id/reject', authenticate, authorize('LIBRARIAN'), rejectBorrowController);

/* ── Borrowing & returns (staff-assisted immediate walk-in checkout) ─────────── */
router.post('/borrow', authenticate, authorize('LIBRARIAN'), borrowBookController);
router.put('/return/:transactionId', authenticate, authorize('LIBRARIAN'), returnBookController);

/* ── User's borrowed books ────────────────────────────────────────────────────── */
router.get('/my-books', authenticate, getMyBooks);
router.post('/my-books/:transactionId/return-request', authenticate, requestReturnController);

/* ── Borrower-marked returns awaiting librarian confirmation ─────────────────── */
router.get('/returns/pending', authenticate, authorize('LIBRARIAN', 'ADMIN'), getPendingReturnsController);
router.put('/returns/:transactionId/deny', authenticate, authorize('LIBRARIAN'), denyReturnController);

/* ── Library-specific user access management (librarian, not full account) ──── */
router.get('/users', authenticate, authorize('LIBRARIAN', 'ADMIN'), getLibraryUsersController);
router.put('/users/:id/block', authenticate, authorize('LIBRARIAN'), blockLibraryAccessController);
router.put('/users/:id/unblock', authenticate, authorize('LIBRARIAN'), unblockLibraryAccessController);

/* ── Reporting (view-only — ADMIN keeps read access) ─────────────────────────── */
router.get('/reports/circulation', authenticate, authorize('LIBRARIAN', 'ADMIN'), getCirculationStats);
router.get('/reports/summary', authenticate, authorize('LIBRARIAN', 'ADMIN'), getLibrarySummary);

/* ── Dashboard: overdue loans ─────────────────────────────────────────────────── */
router.get('/loans/overdue', authenticate, authorize('LIBRARIAN', 'ADMIN'), getOverdueLoansController);

module.exports = router;