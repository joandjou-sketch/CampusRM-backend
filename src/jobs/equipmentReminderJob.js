'use strict';

/**
 * Equipment reminder job — scheduled daily via node-cron in server.js.
 * Notifies users with a checkout due tomorrow (IT-03), flags overdue
 * checkouts, and restricts repeat-overdue users (IT-04).
 */

const { processEquipmentReminders } = require('../modules/equipment/service');

async function processEquipmentReminderJob() {
  const result = await processEquipmentReminders();

  console.log('[EquipmentReminderJob]', new Date().toISOString(), result);
  return result;
}

module.exports = { processEquipmentReminderJob };
