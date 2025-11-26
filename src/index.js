/**
 * Edyna portal automation:
 *  - Login
 *  - Click "Verbraucher" (longer / configurable wait)
 *  - Click first curve button (Stundenprofil)
 *  - Scrape monthly Wirkenergie (kWh) values shown in curve tab
 *  - Navigate to daily view for latest month with data
 *  - Scrape daily hourly kWh usage (24-hour breakdown per day)
 *
 * ENV:
 *   LOGIN_URL        - Full login URL (with ReturnUrl)
 *   USERNAME         - Portal username
 *   PASSWORD         - Portal password
 *   HEADLESS         - "true" | "false" (default true)
 *   DEBUG_SHOTS      - "true" screenshots on failure
 *   DAILY_OUTPUT_FILE - Output file for daily usage JSON (default: daily_usage.json)
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

async function launchBrowser() {
  const headlessEnv = process.env.HEADLESS;
  const headless = headlessEnv ? headlessEnv === 'true' : true;
  return puppeteer.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ],
    defaultViewport: { width: 1400, height: 900 }
  });
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

  return { raw: data.map, parsed, months: data.months };
}

/* ---------- Find latest non-null month and click ---------- */
async function findLatestNonNullMonthAndClick(page, monthsData) {
  const GRID_SELECTOR = '#body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva';
  
  console.log('[daily] Finding latest non-null month...');
  
  // Find the last month with non-null data
  let lastNonNullMonth = null;
  let lastNonNullIndex = -1;
  
  for (let i = monthsData.months.length - 1; i >= 0; i--) {
    const monthName = monthsData.months[i];
    const value = monthsData.parsed[monthName];
    if (value !== null && value !== undefined) {
      lastNonNullMonth = monthName;
      lastNonNullIndex = i;
      break;
    }
  }
  
  if (lastNonNullMonth === null) {
    console.log('[daily] No non-null month found, skipping daily view navigation.');
    return false;
  }
  
  console.log(`[daily] Latest non-null month: ${lastNonNullMonth} (index ${lastNonNullIndex})`);
  
  // Click the link for this month
  const clicked = await page.evaluate((index) => {
    const grid = document.querySelector('#body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva');
    if (!grid) return false;
    
    const anchorNodes = Array.from(
      grid.querySelectorAll('tr:nth-child(2) a[id^="body_ctl00_ctl00_tcListUtenze_TCurve_cCurve_gvCurveAttiva_btnCurve"]')
    );
    
    if (index < 0 || index >= anchorNodes.length) return false;
    
    const link = anchorNodes[index];
    link.click();
    return true;
  }, lastNonNullIndex);
  
  if (!clicked) {
    console.log('[daily] Failed to click monthly view link.');
    return false;
  }
  
  console.log(`[daily] Navigating to monthly view for: ${lastNonNullMonth}`);
  await waitForIdle(page, { timeout: 30000 });
  await sleep(2000);
  
  return lastNonNullMonth;
}

/* ---------- Scrape daily hourly usage ---------- */
async function scrapeDailyHourlyUsage(page, monthName = null) {
  console.log('[daily] Parsing daily hourly data...');
  
  // Try multiple selector strategies to find the hourly data table
  const data = await page.evaluate(() => {
    // Strategy 1: Look for tables with ID containing 'gvDettaglio' or similar
    let table = document.querySelector('table[id*="gvDettaglio"]');
    
    // Strategy 2: Look for tables with ID containing 'Consumi' or 'Giornalier'
    if (!table) {
      table = document.querySelector('table[id*="Consumi"]');
    }
    if (!table) {
      table = document.querySelector('table[id*="Giornalier"]');
    }
    
    // Strategy 3: Look for tables with many columns (hourly data typically has 24+ columns)
    if (!table) {
      const tables = Array.from(document.querySelectorAll('table'));
      for (const t of tables) {
        const headerRow = t.querySelector('tr:first-child');
        if (headerRow) {
          const headers = Array.from(headerRow.querySelectorAll('th'));
          if (headers.length >= 24) {
            table = t;
            break;
          }
        }
      }
    }
    
    if (!table) {
      return { error: 'No suitable table found with hourly data' };
    }
    
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) {
      return { error: 'Table has insufficient rows' };
    }
    
    // Parse headers (first row should have hour labels or column headers)
    const headerRow = rows[0];
    const headers = Array.from(headerRow.querySelectorAll('th, td')).map(cell => 
      cell.innerText.trim()
    );
    
    // Parse data rows (each row should be a day with hourly values)
    const days = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length === 0) continue;
      
      // First cell is typically the date
      const dateCell = cells[0].innerText.trim();
      
      // Remaining cells are hourly values
      const hourlyValues = [];
      for (let j = 1; j < cells.length; j++) {
        const value = cells[j].innerText.trim();
        hourlyValues.push(value);
      }
      
      days.push({
        dateCell,
        hourlyValues
      });
    }
    
    return { headers, days, tableId: table.id };
  });
  
  if (data.error) {
    console.log(`[daily] Error: ${data.error}`);
    return null;
  }
  
  console.log(`[daily] Found table with ID: ${data.tableId || 'unknown'}`);
  console.log(`[daily] Headers: ${data.headers.length} columns`);
  console.log(`[daily] Scraped ${data.days.length} days with hourly data.`);
  
  // Try to extract year from the first day's date cell, or use current year as fallback
  let year = new Date().getFullYear();
  if (data.days.length > 0 && data.days[0].dateCell) {
    // Try to parse year from date cell (common formats: DD/MM/YYYY, DD.MM.YYYY, etc.)
    const yearMatch = data.days[0].dateCell.match(/\d{4}/);
    if (yearMatch) {
      year = parseInt(yearMatch[0], 10);
    }
  }
  
  // Process and structure the data
  const result = {
    year: year,
    month: monthName, // Month name passed from context
    days: []
  };
  
  // Helper to normalize numeric strings
  const normalizeNumber = (str) => {
    if (!str || str === '' || str === '-' || str === 'N/A') return null;
    const normalized = str
      .replace(/\./g, '')    // remove thousand separators
      .replace(',', '.')     // decimal comma -> dot
      .replace(/[^\d.-]/g, ''); // remove stray chars
    const num = normalized ? parseFloat(normalized) : null;
    return Number.isFinite(num) ? num : null;
  };
  
  // Parse each day
  for (const dayData of data.days) {
    const hours = {};
    let totalKwh = 0;
    let validValues = 0;
    
    // Map hourly values (assuming headers start from index 1 for hour columns)
    // Generate hour labels 00:00 through 23:00
    for (let h = 0; h < Math.min(24, dayData.hourlyValues.length); h++) {
      const hourLabel = `${String(h).padStart(2, '0')}:00`;
      const value = normalizeNumber(dayData.hourlyValues[h]);
      hours[hourLabel] = value;
      
      if (value !== null) {
        totalKwh += value;
        validValues++;
      }
    }
    
    // Try to parse date from dateCell
    let date = dayData.dateCell;
    
    // If there are valid hourly values, add this day
    if (validValues > 0) {
      result.days.push({
        date,
        hours,
        total_kwh: parseFloat(totalKwh.toFixed(3))
      });
    }
  }
  
  if (result.days.length > 0) {
    console.log(`[daily] Sample day ${result.days[0].date}:`, JSON.stringify(result.days[0].hours, null, 2).substring(0, 200) + '...');
  }
  
  return result;
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

    console.log('[main] Starting login...');
    await performLogin(page, { loginUrl, username, password });

    console.log('[main] Clicking Verbraucher (extended wait)...');
    await clickVerbraucher(page);

    console.log('[main] Clicking first curve button...');
    await clickFirstCurve(page);

    console.log('[main] Scraping monthly Wirkenergie...');
    const monthlyData = await scrapeMonthlyActiveEnergy(page);

    console.log('[main] Final parsed Wirkenergie object:');
    console.log(JSON.stringify(monthlyData.parsed, null, 2));

    // New feature: Scrape daily hourly usage
    console.log('\n[main] Starting daily hourly data scraping...');
    const monthName = await findLatestNonNullMonthAndClick(page, monthlyData);
    
    if (monthName) {
      try {
        const dailyData = await scrapeDailyHourlyUsage(page, monthName);
        
        if (dailyData && dailyData.days.length > 0) {
          console.log('[main] Daily hourly data summary:');
          console.log(`  Total days: ${dailyData.days.length}`);
          
          // Save to file
          const outputFile = process.env.DAILY_OUTPUT_FILE || 'daily_usage.json';
          fs.writeFileSync(outputFile, JSON.stringify(dailyData, null, 2));
          console.log(`[main] Daily usage data saved to: ${outputFile}`);
        } else {
          console.log('[main] No daily hourly data found or parsed.');
        }
      } catch (e) {
        console.error('[daily] Error scraping daily data:', e.message);
        if (process.env.DEBUG_SHOTS === 'true') {
          await page.screenshot({ path: 'error_daily.png', fullPage: true });
          console.log('[daily] Saved screenshot: error_daily.png');
        }
      }
    }

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
