/**
 * Scheduler using node-cron
 * Runs the scraper with database mode daily at 12:00
 */

require('dotenv').config();
const cron = require('node-cron');
const { spawn } = require('child_process');

const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 12 * * *'; // Default: 12:00 daily

console.log(`[scheduler] Starting with schedule: ${CRON_SCHEDULE}`);
console.log('[scheduler] Waiting for scheduled time...');

// Run scraper function
function runScraper() {
  console.log(`[scheduler] Starting scraper at ${new Date().toISOString()}`);
  
  const scraper = spawn('node', ['src/index.js', '--db'], {
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

// Schedule the job
cron.schedule(CRON_SCHEDULE, () => {
  runScraper();
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
