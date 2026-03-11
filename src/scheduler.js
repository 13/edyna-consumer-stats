/**
 * Scheduler using node-cron
 */

require('dotenv').config();
const cron = require('node-cron');
const { spawn } = require('child_process');

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *'; // Default: 10:00 daily

console.log(`[scheduler] Starting with schedule: ${CRON_SCHEDULE}`);
console.log('[scheduler] Waiting for scheduled time...');

// Run scraper function with optional extra args
function runScraper(extraArgs = []) {
  const args = ['src/index.js', '--db', ...extraArgs];
  console.log(`[scheduler] Starting scraper at ${new Date().toISOString()} (args: ${args.join(' ')})`);

  const scraper = spawn('node', args, {
    stdio: 'inherit',
    cwd: process.cwd()
  });

  scraper.on('close', (code) => {
    console.log(`[scheduler] Scraper finished with code ${code} at ${new Date().toISOString()}`);
  });

  scraper.on('error', (err) => {
    console.error('[scheduler] Failed to start scraper:', err.message);
  });
}

// Returns { year, month } for the previous calendar month (month is 1-based).
// Handles the January edge case: if the current month is January (getMonth() === 0),
// setMonth(-1) automatically rolls back to December (11) of the previous year.
// e.g. called in January 2026 → { year: 2025, month: 12 }
function lastMonth() {
  const d = new Date();
  d.setDate(1);           // avoid day-of-month overflow when subtracting a month
  d.setMonth(d.getMonth() - 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// Regular schedule (configurable via CRON_SCHEDULE env, default: daily at 10:00)
cron.schedule(CRON_SCHEDULE, () => {
  runScraper();
}, {
  timezone: process.env.TZ || 'Europe/Rome'
});

// On the 4th of every month at 10:00: scrape the previous full month.
// If today is in January, lastMonth() correctly returns December of the previous year.
cron.schedule('0 23 3,10 * *', () => {
  const { year, month } = lastMonth();
  console.log(`[scheduler] run: scraping last month (${year}-${String(month).padStart(2, '0')})`);
  runScraper(['--year', String(year), '--month', String(month)]);
}, {
  timezone: process.env.TZ || 'Europe/Rome'
});

// Run immediately if RUN_ON_START is set
if (process.env.RUN_ON_START === 'true') {
  console.log('[scheduler] RUN_ON_START enabled, running immediately...');
  runScraper();
}

// Keep process alive
process.on('SIGINT', () => {
  console.log('[scheduler] Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[scheduler] Received SIGTERM, shutting down...');
  process.exit(0);
});
