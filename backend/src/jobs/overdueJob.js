'use strict';

/**
 * Overdue job module — scheduled daily via node-cron in server.js
 * (cron.schedule('0 2 * * *', () => processOverdueJob())).
 *
 * Environment variables:
 *   OVERDUE_SUSPEND_THRESHOLD (default: 3) — number of overdue items before suspension
 */

const { processOverdueTransactions } = require('../modules/library/service');

async function processOverdueJob(threshold) {
  const count = parseInt(process.env.OVERDUE_SUSPEND_THRESHOLD) || threshold || 3;
  const result = await processOverdueTransactions(count);

  console.log('[OverdueJob]', new Date().toISOString(), result);
  return result;
}

module.exports = { processOverdueJob };