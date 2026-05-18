const cron = require('node-cron');
const config = require('./config');
const log = require('./logger');
const { main } = require('./index');

log.info({ schedule: config.CRON_SCHEDULE }, '[scheduler] Starting');

function runScraper({ year = null, month = null } = {}) {
  const label = year && month ? `${year}-${String(month).padStart(2, '0')}` : 'current';
  log.info({ label }, '[scheduler] Starting scraper run');

  return main({ year, month, dbMode: true }).catch(err => {
    log.error({ err }, '[scheduler] Scraper run failed');
  });
}

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

cron.schedule(config.CRON_SCHEDULE, () => {
  runScraper();
}, { timezone: config.TZ });

// 3rd and 10th of each month: scrape the previous full month
cron.schedule('0 23 3,10 * *', () => {
  const { year, month } = lastMonth();
  log.info({ year, month }, '[scheduler] Backfill run: scraping last month');
  runScraper({ year, month });
}, { timezone: config.TZ });

if (config.RUN_ON_START) {
  log.info('[scheduler] RUN_ON_START enabled, running immediately');
  runScraper();
}

process.on('SIGINT',  () => { log.info('[scheduler] SIGINT received, shutting down'); process.exit(0); });
process.on('SIGTERM', () => { log.info('[scheduler] SIGTERM received, shutting down'); process.exit(0); });
