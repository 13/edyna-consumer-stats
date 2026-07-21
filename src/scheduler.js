import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cron from 'node-cron';
import config from './config.js';
import log from './logger.js';
import { main } from './index.js';

log.info({ schedule: config.CRON_SCHEDULE }, '[scheduler] Starting');

let currentRun = null;
let shuttingDown = false;

function runScraper({ year = null, month = null } = {}) {
  if (shuttingDown) return;
  if (currentRun) {
    log.warn('[scheduler] Previous run still in progress, skipping this trigger');
    return;
  }

  const label = year && month ? `${year}-${String(month).padStart(2, '0')}` : 'current';
  log.info({ label }, '[scheduler] Starting scraper run');

  currentRun = main({ year, month, dbMode: true })
    .catch(err => {
      log.error({ err }, '[scheduler] Scraper run failed');
    })
    .finally(() => {
      currentRun = null;
    });
  return currentRun;
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

/* ---------- Liveness heartbeat (checked by Docker HEALTHCHECK) ---------- */
const HEARTBEAT_FILE = path.join(os.tmpdir(), 'edyna-heartbeat');
const touchHeartbeat = () => writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {});
touchHeartbeat();
setInterval(touchHeartbeat, 60_000);

/* ---------- Graceful shutdown ---------- */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, '[scheduler] Shutting down');
  if (currentRun) {
    log.info('[scheduler] Waiting for in-flight scraper run to finish');
    await currentRun;
  }
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
