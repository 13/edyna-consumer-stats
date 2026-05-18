const { Pool } = require('pg');
const config = require('./config');
const log = require('./logger');

const HOURS_PER_DAY = 24;

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.DB_USER || !config.DB_PASSWORD) {
      throw new Error('DB_USER and DB_PASSWORD are required for database mode');
    }

    pool = new Pool({
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

async function initializeSchema() {
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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_edyna_hourly_timestamp ON edyna_hourly (timestamp DESC);
    `);

    log.info('Schema initialized');
  } finally {
    client.release();
  }
}

async function saveDailyHourlyData(dailyData) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    let insertedCount = 0;
    let updatedCount = 0;

    for (const day of dailyData.days) {
      const dateStr = day.date;
      let timestamp;

      try {
        if (/^\d{2}[/.]\d{2}[/.]\d{4}$/.test(dateStr)) {
          const [d, m, y] = dateStr.split(/[/.]/).map(Number);
          timestamp = new Date(y, m - 1, d);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          timestamp = new Date(dateStr);
        } else {
          timestamp = new Date(dateStr);
        }

        if (isNaN(timestamp.getTime())) {
          log.warn({ dateStr }, 'Skipping invalid date');
          continue;
        }
      } catch (err) {
        log.warn({ dateStr, err: err.message }, 'Failed to parse date');
        continue;
      }

      for (let h = 0; h < HOURS_PER_DAY; h++) {
        const hourLabel = `${String(h).padStart(2, '0')}:00`;
        const kwh = day.hours[hourLabel];
        if (kwh === null || kwh === undefined) continue;

        const recordTimestamp = new Date(timestamp);
        recordTimestamp.setHours(h, 0, 0, 0);

        const existingResult = await client.query(
          'SELECT kwh FROM edyna_hourly WHERE timestamp = $1',
          [recordTimestamp]
        );

        const existingKwh = existingResult.rows.length > 0 ? existingResult.rows[0].kwh : null;
        if (existingKwh !== null && kwh - existingKwh <= 0.001) continue;

        await client.query(
          `INSERT INTO edyna_hourly (timestamp, kwh)
           VALUES ($1, $2)
           ON CONFLICT (timestamp)
           DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = NOW()`,
          [recordTimestamp, kwh]
        );

        if (existingKwh === null) {
          insertedCount++;
        } else {
          updatedCount++;
          log.debug({ ts: recordTimestamp.toISOString(), from: existingKwh, to: kwh }, 'Updated hourly record');
        }
      }
    }

    await client.query('COMMIT');
    log.info({ insertedCount, updatedCount }, 'Saved daily hourly data');
    return { insertedCount, updatedCount };
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err }, 'Error saving daily hourly data');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    log.info('Database connection closed');
  }
}

module.exports = { initializeSchema, saveDailyHourlyData, closePool };
