import pg from 'pg';
import config from './config.js';
import log from './logger.js';
import { parseDayDate, hourTimestamps } from './util.js';

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.DB_USER || !config.DB_PASSWORD) {
      throw new Error('DB_USER and DB_PASSWORD are required for database mode');
    }

    pool = new pg.Pool({
      host:     config.DB_HOST,
      port:     config.DB_PORT,
      database: config.DB_NAME,
      user:     config.DB_USER,
      password: config.DB_PASSWORD,
      ssl:      config.DB_SSL ? { rejectUnauthorized: config.DB_SSL_REJECT_UNAUTHORIZED } : false,
    });

    pool.on('error', (err) => log.error({ err }, 'Unexpected error on idle DB client'));
  }
  return pool;
}

export async function initializeSchema() {
  const client = await getPool().connect();
  try {
    log.info('Creating schema if not exists...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS edyna_hourly (
        timestamp  TIMESTAMPTZ      NOT NULL PRIMARY KEY,
        kwh        DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ      DEFAULT NOW(),
        updated_at TIMESTAMPTZ      DEFAULT NOW()
      );
    `);

    await client.query(`
      SELECT create_hypertable('edyna_hourly', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);
    `).catch((err) => {
      if (err.message.includes('function create_hypertable') || err.message.includes('does not exist')) {
        log.info('TimescaleDB not available, using regular table');
      } else {
        throw err;
      }
    });

    // PK already indexes timestamp; remove the duplicate index older versions created
    await client.query('DROP INDEX IF EXISTS idx_edyna_hourly_timestamp;');

    log.info('Schema initialized');
  } finally {
    client.release();
  }
}

/**
 * Upsert scraped hourly values in one statement.
 * Rows whose stored kwh already equals the scraped value are left untouched
 * (IS DISTINCT FROM), so updated_at only moves on real changes.
 *
 * @param {{ year: number|null, days: Array<{date: string, hourly: Array<number|null>}> }} dailyData
 */
export async function saveDailyHourlyData(dailyData) {
  const rows = [];
  for (const day of dailyData.days) {
    const parsedDate = parseDayDate(day.date, dailyData.year);
    if (!parsedDate) {
      log.warn({ date: day.date }, 'Skipping unparseable date');
      continue;
    }
    const timestamps = hourTimestamps(parsedDate, day.hourly.length);
    day.hourly.forEach((kwh, h) => {
      if (kwh !== null && kwh !== undefined) rows.push([timestamps[h], kwh]);
    });
  }

  if (rows.length === 0) {
    log.info('No rows to save');
    return { insertedCount: 0, updatedCount: 0, unchangedCount: 0 };
  }

  const placeholders = rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
  const params = rows.flat();

  const result = await getPool().query(
    `INSERT INTO edyna_hourly (timestamp, kwh)
     VALUES ${placeholders}
     ON CONFLICT (timestamp)
     DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = NOW()
     WHERE edyna_hourly.kwh IS DISTINCT FROM EXCLUDED.kwh
     RETURNING (xmax = 0) AS inserted`,
    params
  );

  const insertedCount = result.rows.filter(r => r.inserted).length;
  const updatedCount = result.rows.length - insertedCount;
  const unchangedCount = rows.length - result.rows.length;

  log.info({ insertedCount, updatedCount, unchangedCount }, 'Saved daily hourly data');
  return { insertedCount, updatedCount, unchangedCount };
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    log.info('Database connection closed');
  }
}
