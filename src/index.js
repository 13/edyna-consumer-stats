/**
 * Edyna portal automation:
 *  - Login
 *  - Click "Verbraucher" (longer / configurable wait)
 *  - Click first curve button (Stundenprofil)
 *  - Scrape monthly Wirkenergie (kWh) values shown in curve tab
 *  - Navigate to daily view for latest month with data
 *  - Scrape daily hourly kWh usage (per-hour breakdown per day)
 *  - Save to TimescaleDB database (--db flag)
 *
 * ENV: see src/config.js for full list
 *
 * Usage:
 *   npm start                                          - Scrape only (no database), latest month
 *   npm run start:db                                   - Scrape and save to database, latest month
 *   node src/index.js --year 2025                      - Scrape specific year
 *   node src/index.js --month 3                        - Scrape specific month (1=Jan … 12=Dec)
 *   node src/index.js --year 2025 --month 3            - Scrape March 2025
 *   node src/index.js --db --year 2025 --month 3       - Above + save to database
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import config from './config.js';
import log from './logger.js';
import * as db from './db.js';
import { normalizeNumber } from './util.js';

/* ---------- Selectors ---------- */
const SELECTORS = {
  loginUser:      '#body_body_cLogin_txtUser',
  loginPassword:  '#body_body_cLogin_txtPassword',
  loginBtn:       '#body_body_cLogin_btnLogin',
  loginPanel:     '#body_body_cLogin_pnlLogin',
  menuVerbraucher:'#body_ctl00_mMenu1_FirstLevelMenuRepeater_lnkLevelMenu_0',
  tabContainer:   '#body_ctl00_ctl00_tcListUtenze',
  consumerTable:  '#body_ctl00_ctl00_tcListUtenze_TList_cUFListUtenze_gvUtenze',
  curveBtn:       '#body_ctl00_ctl00_tcListUtenze_TList_cUFListUtenze_gvUtenze_btnCurve_0',
  yearDropdown:   '#body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_ddlAnno',
  energyGrid:     '#body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva',
  // Prefix for ID-attribute matching inside page.evaluate()
  monthBtnPrefix: 'body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva_btnCurve',
};

/* ---------- Utilities ---------- */
function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function withRetry(fn, { maxAttempts = 3, baseDelay = 10000, label = 'operation' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const wait = baseDelay * attempt;
        log.warn({ attempt, maxAttempts, waitMs: wait }, `[${label}] failed, retrying: ${err.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

async function saveScreenshot(page, name) {
  if (!config.DEBUG_SHOTS) return;
  try {
    const file = path.join(config.SCREENSHOT_DIR, name);
    await page.screenshot({ path: file, fullPage: true });
    log.info({ file }, '[debug] Screenshot saved');
  } catch (err) {
    log.warn({ err: err.message }, '[debug] Screenshot failed');
  }
}

/* ---------- Browser ---------- */
async function launchBrowser() {
  return puppeteer.launch({
    headless: config.HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1400, height: 900 },
  });
}

/* ---------- Generic idle wait ---------- */
// WebForms partial postbacks don't always navigate, so a bounded network-idle
// wait is the best available "page settled" signal.
async function settle(page, { timeout = 20000 } = {}) {
  try {
    await page.waitForNetworkIdle({ idleTime: 750, timeout });
  } catch {
    log.debug({ timeout }, '[settle] Network not idle within timeout, continuing');
  }
}

/* ---------- Login ---------- */
async function performLogin(page, { loginUrl, username, password }) {
  log.info({ loginUrl }, '[login] Opening login URL');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  log.info('[login] Filling credentials');
  await page.locator(SELECTORS.loginUser).setTimeout(5000).fill(username);
  await page.locator(SELECTORS.loginPassword).setTimeout(5000).fill(password);

  log.info('[login] Submitting');
  const beforeUrl = page.url();
  await page.locator(SELECTORS.loginBtn).setTimeout(5000).click();
  await settle(page, { timeout: 20000 });

  const afterUrl = page.url();
  const loginPanelExists = await page.$(SELECTORS.loginPanel) !== null;
  const success = !loginPanelExists || (afterUrl !== beforeUrl && !afterUrl.includes('Login.tws'));

  if (!success) {
    await saveScreenshot(page, 'login_failure.png');
    throw new Error('Login not confirmed as successful.');
  }
  log.info({ afterUrl }, '[login] Login successful');
}

/* ---------- Click Verbraucher ---------- */
async function clickVerbraucher(page) {
  log.info('[verbraucher] Clicking menu item');
  const beforeUrl = page.url();
  await page.locator(SELECTORS.menuVerbraucher).setTimeout(25000).click();
  await settle(page, { timeout: 30000 });

  const tabExists   = await page.$(SELECTORS.tabContainer)   !== null;
  const tableExists = await page.$(SELECTORS.consumerTable)  !== null;
  log.info({ tabExists, tableExists, urlChanged: page.url() !== beforeUrl }, '[verbraucher] Post-click state');

  if (!tabExists && !tableExists) {
    log.warn('[verbraucher] Content not detected; proceeding cautiously');
  }
}

/* ---------- Click first curve button ---------- */
async function clickFirstCurve(page) {
  log.info('[curve] Waiting for curve button');
  try {
    await page.locator(SELECTORS.curveBtn).setTimeout(360000).click();
  } catch (err) {
    await saveScreenshot(page, 'curve_button_failure.png');
    throw new Error(`Curve button (btnCurve_0) not clickable: ${err.message}`);
  }
  await settle(page, { timeout: 360000 });
}

/* ---------- Select year ---------- */
async function selectYear(page, year) {
  log.info('[year] Waiting for year dropdown');
  await page.waitForSelector(SELECTORS.yearDropdown, { timeout: 60000 }).catch(() => {
    throw new Error('Year dropdown (ddlAnno) not found.');
  });

  const available = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? Array.from(el.options).map(o => o.value) : [];
  }, SELECTORS.yearDropdown);

  if (!available.includes(String(year))) {
    throw new Error(`Year ${year} not available. Available: ${available.join(', ')}`);
  }

  log.info({ year }, '[year] Selecting year');
  await page.select(SELECTORS.yearDropdown, String(year));
  await settle(page, { timeout: 60000 });
  log.info({ year }, '[year] Year selected');
}

/* ---------- Scrape monthly active energy ---------- */
async function scrapeMonthlyActiveEnergy(page) {
  log.info('[scrape] Waiting for energy grid');
  await page.waitForSelector(SELECTORS.energyGrid, { timeout: 360000 }).catch(() => {
    throw new Error('Active energy grid not found after extended wait.');
  });

  const data = await page.evaluate((gridSel, btnPrefix) => {
    const grid = document.querySelector(gridSel);
    if (!grid) return { months: [], values: [], map: {} };

    const monthNames = Array.from(grid.querySelectorAll('tr:first-child th'))
      .map(th => th.innerText.trim());

    const anchorNodes = Array.from(
      grid.querySelectorAll(`tr:nth-child(2) a[id^="${btnPrefix}"]`)
    );

    const rawValues = anchorNodes.map(a => a.innerText.replace(/\s*<i.*$/i, '').trim());
    const map = {};
    monthNames.forEach((m, i) => { map[m] = rawValues[i] || ''; });

    return { months: monthNames, values: rawValues, map };
  }, SELECTORS.energyGrid, SELECTORS.monthBtnPrefix);

  const parsed = {};
  for (const [month, raw] of Object.entries(data.map)) {
    parsed[month] = normalizeNumber(raw);
  }

  return { raw: data.map, parsed, months: data.months };
}

/* ---------- Find latest non-null month and click ---------- */
/**
 * @param {object} page
 * @param {object} monthsData    - { months, parsed }
 * @param {number|null} targetMonthIndex - 0-based; null = auto-select latest non-null
 */
async function findLatestNonNullMonthAndClick(page, monthsData, targetMonthIndex = null) {
  let lastNonNullMonth = null;
  let lastNonNullIndex = -1;

  if (targetMonthIndex !== null) {
    if (targetMonthIndex < 0 || targetMonthIndex >= monthsData.months.length) {
      log.warn({ targetMonthIndex }, '[daily] Requested month index out of range');
      return false;
    }
    lastNonNullIndex = targetMonthIndex;
    lastNonNullMonth = monthsData.months[targetMonthIndex];
    log.info({ month: lastNonNullMonth, index: lastNonNullIndex }, '[daily] Using requested month');
  } else {
    for (let i = monthsData.months.length - 1; i >= 0; i--) {
      const monthName = monthsData.months[i];
      if (monthsData.parsed[monthName] != null) {
        lastNonNullMonth = monthName;
        lastNonNullIndex = i;
        break;
      }
    }
  }

  if (lastNonNullMonth === null) {
    log.info('[daily] No non-null month found, skipping daily view');
    return false;
  }

  log.info({ month: lastNonNullMonth, index: lastNonNullIndex }, '[daily] Target month');

  const clicked = await page.evaluate((gridSel, btnPrefix, index) => {
    const grid = document.querySelector(gridSel);
    if (!grid) return false;
    const anchors = Array.from(grid.querySelectorAll(`tr:nth-child(2) a[id^="${btnPrefix}"]`));
    if (index < 0 || index >= anchors.length) return false;
    anchors[index].click();
    return true;
  }, SELECTORS.energyGrid, SELECTORS.monthBtnPrefix, lastNonNullIndex);

  if (!clicked) {
    log.warn('[daily] Failed to click monthly view link');
    return false;
  }

  log.info({ month: lastNonNullMonth }, '[daily] Navigating to monthly view');
  await settle(page, { timeout: 360000 });

  return lastNonNullMonth;
}

/* ---------- Scrape daily hourly usage ---------- */
/**
 * Returns { year, month, days: [{ date, hourly: Array<number|null>, total_kwh }] }.
 * `hourly` keeps every value column the portal shows (23/24/25 on DST days);
 * index h = h-th hour after local midnight.
 */
async function scrapeDailyHourlyUsage(page, { monthName = null, expectedYear = null } = {}) {
  log.info('[daily] Parsing daily hourly data');

  const data = await page.evaluate(() => {
    let table = document.querySelector('table[id*="gvDettaglio"]');
    if (!table) table = document.querySelector('table[id*="Consumi"]');
    if (!table) table = document.querySelector('table[id*="Giornalier"]');
    if (!table) {
      for (const t of document.querySelectorAll('table')) {
        const headers = t.querySelectorAll('tr:first-child th');
        if (headers.length >= 24) { table = t; break; }
      }
    }
    if (!table) return { error: 'No suitable table found with hourly data' };

    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) return { error: 'Table has insufficient rows' };

    const headers = Array.from(rows[0].querySelectorAll('th, td')).map(c => c.innerText.trim());

    const days = [];
    for (let i = 1; i < rows.length; i++) {
      const cells = Array.from(rows[i].querySelectorAll('td'));
      if (!cells.length) continue;
      days.push({
        dateCell: cells[0].innerText.trim(),
        hourlyValues: cells.slice(1).map(c => c.innerText.trim()),
      });
    }

    return { headers, days, tableId: table.id };
  });

  if (data.error) {
    log.warn({ error: data.error }, '[daily] Could not find hourly table');
    return null;
  }

  log.info({ tableId: data.tableId, columns: data.headers.length, days: data.days.length }, '[daily] Found hourly table');

  let year = expectedYear ?? new Date().getFullYear();
  if (data.days.length > 0) {
    const yearMatch = data.days[0].dateCell.match(/\d{4}/);
    if (yearMatch) year = parseInt(yearMatch[0], 10);
  }

  const result = { year, month: monthName, days: [] };

  for (const dayData of data.days) {
    const hourly = dayData.hourlyValues.map(normalizeNumber);
    const valid = hourly.filter(v => v !== null);
    if (valid.length === 0) continue;

    const totalKwh = valid.reduce((sum, v) => sum + v, 0);
    result.days.push({
      date: dayData.dateCell,
      hourly,
      total_kwh: parseFloat(totalKwh.toFixed(3)),
    });
  }

  result.days.forEach(day => log.debug({ date: day.date, total_kwh: day.total_kwh }, '[daily]'));

  return result;
}

/* ---------- Scrape session (what gets retried) ---------- */
async function scrapeSession({ loginUrl, username, password, dbMode, targetYear, targetMonthIndex }) {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await performLogin(page, { loginUrl, username, password });
    await clickVerbraucher(page);
    await clickFirstCurve(page);

    let monthlyData = await scrapeMonthlyActiveEnergy(page);

    if (targetYear !== null) {
      await selectYear(page, targetYear);
      monthlyData = await scrapeMonthlyActiveEnergy(page);
    }

    log.info({ parsed: monthlyData.parsed }, '[main] Monthly Wirkenergie');

    const monthName = await findLatestNonNullMonthAndClick(page, monthlyData, targetMonthIndex);
    if (monthName) {
      const dailyData = await scrapeDailyHourlyUsage(page, { monthName, expectedYear: targetYear });

      if (dailyData && dailyData.days.length > 0) {
        log.info({ days: dailyData.days.length }, '[main] Daily hourly data scraped');
        if (dbMode) {
          log.info('[main] Saving to database');
          await db.saveDailyHourlyData(dailyData);
        }
      } else {
        log.warn('[main] No daily hourly data found');
      }
    }
  } catch (err) {
    if (browser) {
      const pages = await browser.pages().catch(() => []);
      if (pages[0]) await saveScreenshot(pages[0], 'error_scrape.png');
    }
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

/* ---------- Main ---------- */
export async function main({ year = null, month = null, dbMode = false } = {}) {
  if (year !== null && (!Number.isFinite(year) || year < 2020 || year > 2100)) {
    throw new Error(`Invalid year: ${year}. Expected a 4-digit year between 2020-2100.`);
  }
  if (month !== null && (!Number.isFinite(month) || month < 1 || month > 12)) {
    throw new Error(`Invalid month: ${month}. Expected 1-12.`);
  }

  if (dbMode) {
    log.info('[main] Database mode enabled');
    await db.initializeSchema();
  }

  const targetMonthIndex = month !== null ? month - 1 : null;

  try {
    await withRetry(
      () => scrapeSession({
        loginUrl: config.LOGIN_URL,
        username: config.EDYNA_USERNAME,
        password: config.EDYNA_PASSWORD,
        dbMode,
        targetYear: year,
        targetMonthIndex,
      }),
      { maxAttempts: config.SCRAPE_RETRIES, baseDelay: config.SCRAPE_RETRY_DELAY_MS, label: 'scraper' }
    );
    log.info('[main] Flow complete');
  } finally {
    if (dbMode) await db.closePool();
  }
}

/* ---------- CLI entry point ---------- */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { values, positionals } = parseArgs({
    options: {
      db:    { type: 'boolean', default: false },
      year:  { type: 'string' },
      month: { type: 'string' },
    },
    allowPositionals: true,
  });

  const dbMode = values.db || positionals.includes('db');
  const year  = values.year  !== undefined ? parseInt(values.year, 10)  : null;
  const month = values.month !== undefined ? parseInt(values.month, 10) : null;

  main({ year, month, dbMode }).catch(err => {
    log.error({ err }, '[main] Fatal error');
    process.exitCode = 1;
  });
}
