'use strict';

/**
 * End-to-end smoke test for the Auth + Library API.
 * Run the server first (`npm run dev`), then in another terminal:
 *   node scripts/api-smoke-test.js
 *
 * Exercises every implemented route, role-based access control, and key
 * edge cases (404/400/409/422/501), then cleans up the data it created.
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
  librarian: `smoke.librarian.${RUN}@test.com`,
  student1: `smoke.student1.${RUN}@test.com`,
  student2: `smoke.student2.${RUN}@test.com`,
};
const PASSWORD = 'password123';

const tokens = {};

async function testHealth() {
  console.log('\n=== Health ===');
  const r = await api('GET', '/health');
  check('GET /health -> 200', r.status === 200 && r.body.success === true, r);
}

async function testAuth() {
  console.log('\n=== Auth ===');

  for (const [role, email] of [
    ['LIBRARIAN', emails.librarian],
    ['STUDENT', emails.student1],
    ['STUDENT', emails.student2],
  ]) {
    const r = await api('POST', '/auth/register', {
      body: { fullName: `Smoke ${role}`, email, password: PASSWORD, role },
    });
    check(`POST /auth/register (${role}) -> 201`, r.status === 201, r.body);
  }

  const dup = await api('POST', '/auth/register', {
    body: { fullName: 'Dup', email: emails.librarian, password: PASSWORD, role: 'LIBRARIAN' },
  });
  check('POST /auth/register duplicate email -> 409', dup.status === 409, dup.body);

  for (const [key, email] of Object.entries(emails)) {
    const r = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
    check(`POST /auth/login (${key}) -> 200 with token`, r.status === 200 && !!r.body?.data?.token, r.body);
    tokens[key] = r.body?.data?.token;
  }

  const badLogin = await api('POST', '/auth/login', { body: { email: emails.student1, password: 'wrong' } });
  check('POST /auth/login wrong password -> 401', badLogin.status === 401, badLogin.body);

  const noToken = await api('GET', '/library/my-books');
  check('GET /library/my-books without token -> 401', noToken.status === 401, noToken.body);

  const changePw = await api('POST', '/auth/change-password', {
    token: tokens.student1,
    body: { currentPassword: PASSWORD, newPassword: 'newpassword123' },
  });
  check('POST /auth/change-password -> 200', changePw.status === 200, changePw.body);

  const reLogin = await api('POST', '/auth/login', { body: { email: emails.student1, password: 'newpassword123' } });
  check('Login with new password works -> 200', reLogin.status === 200 && !!reLogin.body?.data?.token, reLogin.body);
  tokens.student1 = reLogin.body?.data?.token;

  const logout = await api('POST', '/auth/logout', { token: tokens.student1 });
  check('POST /auth/logout -> 200', logout.status === 200, logout.body);
}

let bookAId;

async function testCatalogue() {
  console.log('\n=== Library catalogue (CRUD + RBAC) ===');

  const create = await api('POST', '/library/books', {
    token: tokens.librarian,
    body: {
      title: `SmokeTest Book A ${RUN}`,
      author: 'Test Author',
      isbn: `978-${RUN}`,
      category: 'Smoke',
      totalCopies: 2,
    },
  });
  check('POST /library/books (librarian) -> 201', create.status === 201, create.body);
  check('  created book has availableCopies = 2', create.body?.data?.availableCopies === 2, create.body);
  bookAId = create.body?.data?._id;

  const missingTitle = await api('POST', '/library/books', {
    token: tokens.librarian,
    body: { author: 'No Title', totalCopies: 1 },
  });
  check('POST /library/books missing title -> 400', missingTitle.status === 400, missingTitle.body);

  const asStudent = await api('POST', '/library/books', {
    token: tokens.student1,
    body: { title: 'Should fail', totalCopies: 1 },
  });
  check('POST /library/books as STUDENT -> 403', asStudent.status === 403, asStudent.body);

  const update = await api('PUT', `/library/books/${bookAId}`, {
    token: tokens.librarian,
    body: { description: 'Updated description' },
  });
  check('PUT /library/books/:id -> 200', update.status === 200, update.body);
  check('  metadata preserved after partial update', update.body?.data?.metadata?.author === 'Test Author', update.body);

  const detail = await api('GET', `/library/books/${bookAId}`, { token: tokens.student1 });
  check('GET /library/books/:id -> 200', detail.status === 200, detail.body);
  check('  availableCopies = 2, activeBorrows = 0', detail.body?.data?.availableCopies === 2 && detail.body?.data?.activeBorrows === 0, detail.body);

  const badId = await api('GET', '/library/books/not-an-id', { token: tokens.student1 });
  check('GET /library/books/<bad-format> -> 400', badId.status === 400, badId.body);

  const notFound = await api('GET', '/library/books/000000000000000000000000', { token: tokens.student1 });
  check('GET /library/books/<nonexistent> -> 404', notFound.status === 404, notFound.body);

  const search = await api('GET', `/library/books?search=${encodeURIComponent(`SmokeTest Book A ${RUN}`)}`, { token: tokens.student1 });
  check('GET /library/books?search= -> finds the book', search.status === 200 && search.body?.data?.length === 1, search.body);
}

const txIds = {};

async function testBorrowReturn() {
  console.log('\n=== Borrow & Return ===');

  const b1 = await api('POST', '/library/borrow', { token: tokens.student1, body: { bookId: bookAId } });
  check('student1 borrows BookA -> 201', b1.status === 201, b1.body);
  txIds.student1 = b1.body?.data?._id;

  const afterB1 = await api('GET', `/library/books/${bookAId}`, { token: tokens.student1 });
  check('  availableCopies 2 -> 1 after borrow', afterB1.body?.data?.availableCopies === 1, afterB1.body);

  const b2 = await api('POST', '/library/borrow', { token: tokens.student2, body: { bookId: bookAId } });
  check('student2 borrows BookA -> 201', b2.status === 201, b2.body);
  txIds.student2 = b2.body?.data?._id;

  const afterB2 = await api('GET', `/library/books/${bookAId}`, { token: tokens.student1 });
  check('  availableCopies 1 -> 0 after second borrow', afterB2.body?.data?.availableCopies === 0, afterB2.body);

  const noCopies = await api('POST', '/library/borrow', { token: tokens.librarian, body: { bookId: bookAId } });
  check('Borrow with 0 copies left -> 409', noCopies.status === 409, noCopies.body);

  const missingBookId = await api('POST', '/library/borrow', { token: tokens.student1, body: {} });
  check('POST /library/borrow without bookId -> 400', missingBookId.status === 400, missingBookId.body);

  const myBooks = await api('GET', '/library/my-books', { token: tokens.student1 });
  check('GET /library/my-books -> includes BookA', myBooks.status === 200 && myBooks.body?.data?.some((t) => t.transactionId === txIds.student1), myBooks.body);

  const returnAsStudent = await api('PUT', `/library/return/${txIds.student1}`, {
    token: tokens.student1,
    body: { conditionAtReturn: 'Good' },
  });
  check('PUT /library/return as STUDENT -> 403', returnAsStudent.status === 403, returnAsStudent.body);

  const returnOk = await api('PUT', `/library/return/${txIds.student1}`, {
    token: tokens.librarian,
    body: { conditionAtReturn: 'Good' },
  });
  check('PUT /library/return as LIBRARIAN -> 200', returnOk.status === 200, returnOk.body);

  const afterReturn = await api('GET', `/library/books/${bookAId}`, { token: tokens.student1 });
  check('  availableCopies 0 -> 1 after return', afterReturn.body?.data?.availableCopies === 1, afterReturn.body);

  const doubleReturn = await api('PUT', `/library/return/${txIds.student1}`, {
    token: tokens.librarian,
    body: { conditionAtReturn: 'Good' },
  });
  check('Returning the same transaction twice -> 400', doubleReturn.status === 400, doubleReturn.body);

  const badTx = await api('PUT', '/library/return/not-an-id', { token: tokens.librarian, body: {} });
  check('Return with bad transaction id format -> 400', badTx.status === 400, badTx.body);

  const noTx = await api('PUT', '/library/return/000000000000000000000000', { token: tokens.librarian, body: {} });
  check('Return nonexistent transaction -> 404', noTx.status === 404, noTx.body);

  const returnStudent2 = await api('PUT', `/library/return/${txIds.student2}`, {
    token: tokens.librarian,
    body: { conditionAtReturn: 'Good' },
  });
  check('PUT /library/return for student2 -> 200', returnStudent2.status === 200, returnStudent2.body);
}

const limitBookIds = [];

async function testBorrowLimit() {
  console.log('\n=== Borrow limit (STUDENT max 5 concurrent) ===');

  for (let i = 1; i <= 6; i++) {
    const r = await api('POST', '/library/books', {
      token: tokens.librarian,
      body: { title: `SmokeTest Limit Book ${i} ${RUN}`, totalCopies: 1 },
    });
    check(`Create limit-test book ${i} -> 201`, r.status === 201, r.body);
    limitBookIds.push(r.body?.data?._id);
  }

  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/library/borrow', { token: tokens.student1, body: { bookId: limitBookIds[i] } });
    check(`student1 borrows limit-test book ${i + 1} -> 201`, r.status === 201, r.body);
  }

  const sixth = await api('POST', '/library/borrow', { token: tokens.student1, body: { bookId: limitBookIds[5] } });
  check('student1 borrows 6th book -> 400 (limit reached)', sixth.status === 400, sixth.body);
}

async function testReporting() {
  console.log('\n=== Reporting ===');

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const missingDates = await api('GET', '/library/reports/circulation', { token: tokens.librarian });
  check('Report without from/to -> 400', missingDates.status === 400, missingDates.body);

  const badFormat = await api('GET', `/library/reports/circulation?from=${today}&to=${tomorrow}&format=xml`, { token: tokens.librarian });
  check('Report with invalid format -> 400', badFormat.status === 400, badFormat.body);

  const json = await api('GET', `/library/reports/circulation?from=${today}&to=${tomorrow}`, { token: tokens.librarian });
  check('Report format=json -> 200 with summary', json.status === 200 && typeof json.body?.data?.summary?.totalBorrows === 'number', json.body);

  const csv = await api('GET', `/library/reports/circulation?from=${today}&to=${tomorrow}&format=csv`, { token: tokens.librarian });
  check('Report format=csv -> 200 with CSV header', csv.status === 200 && typeof csv.body === 'string' && csv.body.startsWith('Transaction ID'), csv.body);

  const pdf = await api('GET', `/library/reports/circulation?from=${today}&to=${tomorrow}&format=pdf`, { token: tokens.librarian });
  check('Report format=pdf -> 501 (not yet implemented)', pdf.status === 501, pdf.body);

  const asStudent = await api('GET', `/library/reports/circulation?from=${today}&to=${tomorrow}`, { token: tokens.student1 });
  check('Report as STUDENT -> 403', asStudent.status === 403, asStudent.body);
}

async function testSoftDelete() {
  console.log('\n=== Soft delete ===');

  const del = await api('DELETE', `/library/books/${bookAId}`, { token: tokens.librarian });
  check('DELETE /library/books/:id -> 200', del.status === 200, del.body);

  const search = await api('GET', `/library/books?search=${encodeURIComponent(`SmokeTest Book A ${RUN}`)}`, { token: tokens.student1 });
  check('Default search hides retired book', search.status === 200 && search.body?.data?.length === 0, search.body);

  const searchRetired = await api('GET', `/library/books?search=${encodeURIComponent(`SmokeTest Book A ${RUN}`)}&status=RETIRED`, { token: tokens.student1 });
  check('search?status=RETIRED shows retired book', searchRetired.status === 200 && searchRetired.body?.data?.length === 1, searchRetired.body);

  const delMissing = await api('DELETE', '/library/books/000000000000000000000000', { token: tokens.librarian });
  check('DELETE nonexistent book -> 404', delMissing.status === 404, delMissing.body);
}

async function cleanup() {
  console.log('\n=== Cleanup ===');
  await mongoose.connect(process.env.MONGO_URI);

  const User = require('../src/models/User');
  const Resource = require('../src/models/Resource');
  const LibraryTransaction = require('../src/models/LibraryTransaction');

  const resources = await Resource.find({ name: { $regex: `SmokeTest.*${RUN}` } });
  const resourceIds = resources.map((r) => r._id);

  await LibraryTransaction.deleteMany({ book: { $in: resourceIds } });
  await Resource.deleteMany({ _id: { $in: resourceIds } });
  await User.deleteMany({ email: { $regex: `${RUN}@test\\.com$` } });

  console.log(`  Removed ${resourceIds.length} test books, their transactions, and 3 test users.`);
  await mongoose.disconnect();
}

(async () => {
  try {
    await testHealth();
    await testAuth();
    await testCatalogue();
    await testBorrowReturn();
    await testBorrowLimit();
    await testReporting();
    await testSoftDelete();
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
