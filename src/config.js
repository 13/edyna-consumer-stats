require('dotenv').config();
const { z } = require('zod');

const boolStr = (def) =>
  z.enum(['true', 'false']).default(def ? 'true' : 'false').transform(v => v === 'true');

const schema = z.object({
  LOGIN_URL:                   z.string().min(1, 'LOGIN_URL is required'),
  USERNAME:                    z.string().min(1, 'USERNAME is required'),
  PASSWORD:                    z.string().min(1, 'PASSWORD is required'),
  HEADLESS:                    boolStr(true),
  DEBUG_SHOTS:                 boolStr(false),
  DB_HOST:                     z.string().default('localhost'),
  DB_PORT:                     z.string().regex(/^\d+$/).default('5432').transform(Number),
  DB_NAME:                     z.string().default('edyna'),
  DB_USER:                     z.string().optional(),
  DB_PASSWORD:                 z.string().optional(),
  DB_SSL:                      boolStr(false),
  DB_SSL_REJECT_UNAUTHORIZED:  boolStr(true),
  CRON_SCHEDULE:               z.string().default('0 9 * * *'),
  RUN_ON_START:                boolStr(false),
  TZ:                          z.string().default('Europe/Rome'),
  LOG_LEVEL:                   z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SCRAPE_RETRIES:              z.string().regex(/^\d+$/).default('1').transform(Number),
  SCRAPE_RETRY_DELAY_MS:       z.string().regex(/^\d+$/).default('10000').transform(Number),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  const issues = result.error.issues.map(i => `  ${i.path[0]}: ${i.message}`).join('\n');
  console.error('[config] Invalid or missing environment variables:\n' + issues);
  process.exit(1);
}

module.exports = result.data;
