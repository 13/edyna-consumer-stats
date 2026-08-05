import os from 'node:os';
import { z } from 'zod';

// Zod 4's .default() takes the *output* type and bypasses parsing,
// so the default must be a boolean, not the string 'true'/'false'.
const boolStr = (def) => z.stringbool().default(def);

const schema = z.object({
  LOGIN_URL:                   z.string().min(1, 'LOGIN_URL is required'),
  // EDYNA_ prefix avoids collision with the shell's own USERNAME variable
  EDYNA_USERNAME:              z.string().min(1, 'EDYNA_USERNAME is required'),
  EDYNA_PASSWORD:              z.string().min(1, 'EDYNA_PASSWORD is required'),
  HEADLESS:                    boolStr(true),
  DEBUG_SHOTS:                 boolStr(false),
  SCREENSHOT_DIR:              z.string().default(os.tmpdir()),
  DB_HOST:                     z.string().default('localhost'),
  DB_PORT:                     z.coerce.number().int().positive().default(5432),
  DB_NAME:                     z.string().default('edyna'),
  DB_USER:                     z.string().optional(),
  DB_PASSWORD:                 z.string().optional(),
  DB_SSL:                      boolStr(false),
  DB_SSL_REJECT_UNAUTHORIZED:  boolStr(true),
  CRON_SCHEDULE:               z.string().default('0 9 * * *'),
  RUN_ON_START:                boolStr(false),
  TZ:                          z.string().default('Europe/Rome'),
  LOG_LEVEL:                   z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SCRAPE_RETRIES:              z.coerce.number().int().min(1).default(3),
  SCRAPE_RETRY_DELAY_MS:       z.coerce.number().int().min(0).default(10000),
});

// Every key may also be set with an EDYNA_ prefix (e.g. EDYNA_CRON_SCHEDULE),
// so a shared .env can namespace all scraper vars. Prefixed wins over unprefixed.
const env = { ...process.env };
for (const key of Object.keys(schema.shape)) {
  const prefixed = process.env[`EDYNA_${key}`];
  if (prefixed !== undefined) env[key] = prefixed;
}

const result = schema.safeParse(env);
if (!result.success) {
  const issues = result.error.issues.map(i => `  ${i.path[0]}: ${i.message}`).join('\n');
  console.error('[config] Invalid or missing environment variables:\n' + issues);
  process.exit(1);
}

// Date parsing and cron must agree on the timezone the portal reports in.
process.env.TZ = result.data.TZ;

export default result.data;
