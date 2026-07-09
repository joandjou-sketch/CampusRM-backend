'use strict';

require('dotenv').config();
const cron = require('node-cron');
const app = require('./src/app');
const connectDB = require('./src/config/db');
const { processOverdueJob } = require('./src/jobs/overdueJob');
const { processEquipmentReminderJob } = require('./src/jobs/equipmentReminderJob');

const PORT = process.env.PORT || 5001;

(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
  });

  /* Daily at 02:00 — flag overdue library loans and suspend repeat offenders */
  cron.schedule('0 2 * * *', () => {
    processOverdueJob().catch((err) => console.error('[OverdueJob] Failed:', err.message));
  });

  /* Daily at 07:00 — remind users with equipment due tomorrow, flag overdue checkouts */
  cron.schedule('0 7 * * *', () => {
    processEquipmentReminderJob().catch((err) => console.error('[EquipmentReminderJob] Failed:', err.message));
  });
})();
