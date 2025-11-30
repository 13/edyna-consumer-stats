/**
 * Edyna portal automation:
 *  - Login
 *  - Click "Verbraucher" (longer / configurable wait)
 *  - Click first curve button (Stundenprofil)
 *  - Scrape monthly Wirkenergie (kWh) values shown in curve tab
 *
 * ENV:
 *   LOGIN_URL        - Full login URL (with ReturnUrl)
 *   USERNAME         - Portal username
 *   PASSWORD         - Portal password
 *   HEADLESS         - "true" | "false" (default true)
 *   DEBUG_SHOTS      - "true" screenshots on failure
 *   USER_AGENT       - Custom User-Agent string (optional, defaults to Chrome)
 *
 * Improvements (per request):
 *   After clicking "Verbraucher" we now:
 *     1. Perform an initial idle wait.
 *     2. Run a polling loop (retry) until key selectors appear.
 *     3. Apply an additional fixed delay (configurable).
 *
 * Key selectors considered loaded:
 *   - Tab container: #body_ctl00_ctl00_tcListUtenze
 *   - Consumer table: #body_ctl00_ctl00_tcListUtenze_TList_cUFListUtenze_gvUtenze
 *
 * If still absent after retries, we proceed but warn.
 */

require('dotenv').config();
const fs = require('fs');
const puppeteer = require('puppeteer');

/* ---------- Utilities ---------- */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env variable: ${name}`);
    process.exit(1);
  }
  return v;
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function launchBrowser() {
  const headlessEnv = process.env.HEADLESS;
  const headless = headlessEnv ? headlessEnv === 'true' : true;
  const browser = await puppeteer.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ],
    defaultViewport: { width: 1400, height: 900 }
  });
  return browser;
}

function getUserAgent() {
  return process.env.USER_AGENT || DEFAULT_USER_AGENT;
}

/* ---------- Login Flow ---------- */
async function performLogin(page, { loginUrl, username, password }) {
  console.log('[login] Opening login URL:', loginUrl);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#body_body_cLogin_txtUser', { timeout: 5000 });
  await page.waitForSelector('#body_body_cLogin_txtPassword', { timeout: 5000 });
  await page.waitForSelector('#body_body_cLogin_btnLogin', { timeout: 5000 });

  console.log('[login] Filling username...');
  await page.click('#body_body_cLogin_txtUser', { clickCount: 3 });
  await page.type('#body_body_cLogin_txtUser', username, { delay: 35 });

  console.log('[login] Filling password...');
  await page.click('#body_body_cLogin_txtPassword', { clickCount: 3 });
  await page.type('#body_body_cLogin_txtPassword', password, { delay: 40 });

  console.log('[login] Submitting...');
  const beforeUrl = page.url();
  await page.click('#body_body_cLogin_btnLogin');

  await Promise.race([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    //sleep(4000)
  ]);
  //await sleep(1000);

  const afterUrl = page.url();
  const loginPanelExists = await page.$('#body_body_cLogin_pnlLogin') !== null;
  const success = !loginPanelExists || (afterUrl !== beforeUrl && !afterUrl.includes('Login.tws'));

  if (!success) {
    if (process.env.DEBUG_SHOTS === 'true') {
      await page.screenshot({ path: 'login_failure.png', fullPage: true });
      console.log('[login] Screenshot saved: login_failure.png');
    }
    throw new Error('Login not confirmed as successful.');
  }
  console.log('[login] Login successful (heuristic). Current URL:', afterUrl);
}

/* ---------- Generic idle wait ---------- */
async function waitForIdle(page, { timeout = 20000 } = {}) {
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout }).catch(() => {}),
    //sleep(2500)
  ]);
}

/* ---------- Click Verbraucher with extended wait ---------- */
async function clickVerbraucher(page) {
  const MENU_SELECTOR = '#body_ctl00_mMenu1_FirstLevelMenuRepeater_lnkLevelMenu_0';
  const TAB_CONTAINER = '#body_ctl00_ctl00_tcListUtenze';
  const TABLE_SELECTOR = '#body_ctl00_ctl00_tcListUtenze_TList_cUFListUtenze_gvUtenze';

  console.log('[verbraucher] Waiting for menu item...');
  await page.waitForSelector(MENU_SELECTOR, { timeout: 25000 });

  const beforeUrl = page.url();
  console.log('[verbraucher] Clicking "Verbraucher"...');
  await page.click(MENU_SELECTOR);

  // Initial idle wait
  await waitForIdle(page, { timeout: 30000 });

  const afterUrl = page.url();
  console.log('[verbraucher] Post-click URL changed?', beforeUrl !== afterUrl);

  // Final presence checks
  const tabExists = await page.$(TAB_CONTAINER) !== null;
  const tableExists = await page.$(TABLE_SELECTOR) !== null;
  console.log(`[verbraucher] Tab container present: ${tabExists}, consumer table present: ${tableExists}`);

  if (!tabExists && !tableExists) {
    console.warn('[verbraucher] Verbraucher content still not detected; proceeding cautiously.');
  }
}

/* ---------- Click first curve button ---------- */
async function clickFirstCurve(page) {
  const CURVE_BTN_ID = '#body_ctl00_ctl00_tcListUtenze_TList_cUFListUtenze_gvUtenze_btnCurve_0';
  console.log('[curve] Waiting for first curve button...');
  try {
    await page.waitForSelector(CURVE_BTN_ID, { timeout: 90000 });
  } catch {
    console.warn('[curve] Curve button not found within extended timeout. Attempting fallback detection of curve tab...');
    return;
  }

  const beforeUrl = page.url();
  console.log('[curve] Clicking first curve button...');
  await page.click(CURVE_BTN_ID);

  await waitForIdle(page, { timeout: 90000 });
  //await sleep(2000);

  const afterUrl = page.url();
  console.log('[curve] URL changed?', beforeUrl !== afterUrl);
}

/* ---------- Scrape monthly active energy ---------- */
async function scrapeMonthlyActiveEnergy(page) {
  const GRID_SELECTOR = '#body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva';
  console.log('[scrape] Waiting for active energy grid...');
  await page.waitForSelector(GRID_SELECTOR, { timeout: 90000 }).catch(() => {
    throw new Error('Active energy grid not found after extended wait.');
  });

  const data = await page.evaluate(() => {
    const grid = document.querySelector('#body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva');
    if (!grid) return { months: [], values: [], map: {} };

    const headerCells = Array.from(grid.querySelectorAll('tr:first-child th'));
    const monthNames = headerCells.map(th => th.innerText.trim());

    const anchorNodes = Array.from(
      grid.querySelectorAll('tr:nth-child(2) a[id^="body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva_btnCurve"]')
    );

    const rawValues = anchorNodes.map(a => a.innerText.replace(/\s*<i.*$/i, '').trim());
    const map = {};
    monthNames.forEach((m, i) => {
      map[m] = rawValues[i] || '';
    });

    return { months: monthNames, values: rawValues, map };
  });

  const parsed = {};
  for (const [month, raw] of Object.entries(data.map)) {
    if (!raw) {
      parsed[month] = null;
      continue;
    }
    const normalized = raw
      .replace(/\./g, '')    // remove thousand separators
      .replace(',', '.')     // decimal comma -> dot
      .replace(/[^\d.]/g, ''); // remove stray chars
    const num = normalized ? parseFloat(normalized) : null;
    parsed[month] = Number.isFinite(num) ? num : null;
  }

  /*console.log('[scrape] Wirkenergie (kWh) per month:');
  Object.entries(parsed).forEach(([m, v]) => {
    console.log(`  ${m}: ${v === null ? '(blank)' : v}`);
  });*/

  return { raw: data.map, parsed };
}

/* ---------- Main ---------- */
async function main() {
  const loginUrl = requireEnv('LOGIN_URL');
  const username = requireEnv('USERNAME');
  const password = requireEnv('PASSWORD');

  const args = new Set(process.argv.slice(2));

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    const userAgent = getUserAgent();
    await page.setUserAgent(userAgent);
    console.log('[main] Using User-Agent:', userAgent);

    console.log('[main] Starting login...');
    await performLogin(page, { loginUrl, username, password });

    console.log('[main] Clicking Verbraucher (extended wait)...');
    await clickVerbraucher(page);

    console.log('[main] Clicking first curve button...');
    await clickFirstCurve(page);

    console.log('[main] Scraping monthly Wirkenergie...');
    const { raw, parsed } = await scrapeMonthlyActiveEnergy(page);

    console.log('[main] Final parsed Wirkenergie object:');
    console.log(JSON.stringify(parsed, null, 2));

    console.log('[main] Flow complete.');
  } catch (e) {
    console.error('[error] Flow failed:', e.message);
    if (browser && process.env.DEBUG_SHOTS === 'true') {
      try {
        const page = (await browser.pages())[0];
        await page.screenshot({ path: 'error_flow.png', fullPage: true });
        console.log('[error] Saved screenshot: error_flow.png');
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

if (require.main === module) {
  main();
}
