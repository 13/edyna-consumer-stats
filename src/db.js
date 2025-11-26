/**
 * TimescaleDB integration for storing daily hourly energy consumption data
 * 
 * ENV:
 *   DB_HOST          - PostgreSQL/TimescaleDB host (default: localhost)
 *   DB_PORT          - PostgreSQL port (default: 5432)
 *   DB_NAME          - Database name (default: edyna)
 *   DB_USER          - Database user (required)
 *   DB_PASSWORD      - Database password (required)
 *   DB_SSL           - Enable SSL (default: false)
 */

const { Pool } = require('pg');

/* ---------- Database Connection ---------- */
let pool = null;

function getPool() {
  if (!pool) {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'edyna',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

    if (!config.user || !config.password) {
      throw new Error('DB_USER and DB_PASSWORD environment variables are required for database mode');
    }

    pool = new Pool(config);
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('[db] Unexpected error on idle client', err);
    });
  }
  
  return pool;
}

/* ---------- Initialize Database Schema ---------- */
async function initializeSchema() {
  const client = await getPool().connect();
  
  try {
    console.log('[db] Creating schema if not exists...');
    
    // Create main table for daily hourly consumption
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_hourly_consumption (
        timestamp TIMESTAMPTZ NOT NULL,
        hour INTEGER NOT NULL CHECK (hour >= 0 AND hour < 24),
        kwh DOUBLE PRECISION NOT NULL,
        month_name TEXT,
        source_date TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (timestamp, hour)
      );
    `);
    
    // Convert to hypertable if TimescaleDB extension is available
    await client.query(`
      SELECT create_hypertable('daily_hourly_consumption', 'timestamp', 
        if_not_exists => TRUE, 
        migrate_data => TRUE
      );
    `).catch((err) => {
      // If TimescaleDB extension is not available, continue without hypertable
      if (err.message.includes('function create_hypertable') || 
          err.message.includes('does not exist')) {
        console.log('[db] TimescaleDB extension not available, using regular table');
      } else {
        throw err;
      }
    });
    
    // Create index for efficient queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_hourly_timestamp 
      ON daily_hourly_consumption (timestamp DESC);
    `);
    
    console.log('[db] Schema initialized successfully');
  } finally {
    client.release();
  }
}

/* ---------- Save Daily Hourly Data ---------- */
async function saveDailyHourlyData(dailyData) {
  const client = await getPool().connect();
  
  try {
    await client.query('BEGIN');
    
    let insertedCount = 0;
    let updatedCount = 0;
    
    for (const day of dailyData.days) {
      // Parse the date from the source format
      // Expected formats: DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, etc.
      const dateStr = day.date;
      let timestamp;
      
      try {
        // Try multiple date parsing strategies
        if (/^\d{2}[/.]\d{2}[/.]\d{4}$/.test(dateStr)) {
          // DD/MM/YYYY or DD.MM.YYYY
          const [d, m, y] = dateStr.split(/[/.]/).map(Number);
          timestamp = new Date(y, m - 1, d);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          // YYYY-MM-DD
          timestamp = new Date(dateStr);
        } else {
          // Try native parsing as fallback
          timestamp = new Date(dateStr);
        }
        
        if (isNaN(timestamp.getTime())) {
          console.warn(`[db] Skipping invalid date: ${dateStr}`);
          continue;
        }
      } catch (err) {
        console.warn(`[db] Failed to parse date: ${dateStr}`, err.message);
        continue;
      }
      
      // Insert/update each hour
      for (const [hourStr, kwh] of Object.entries(day.hours)) {
        if (kwh === null || kwh === undefined) continue;
        
        // Extract hour from "HH:MM" format
        const hour = parseInt(hourStr.split(':')[0], 10);
        
        // Create timestamp for this specific hour
        const hourTimestamp = new Date(timestamp);
        hourTimestamp.setHours(hour, 0, 0, 0);
        
        // Check if value exists
        const existingResult = await client.query(
          'SELECT kwh FROM daily_hourly_consumption WHERE timestamp = $1 AND hour = $2',
          [hourTimestamp, hour]
        );
        
        if (existingResult.rows.length === 0) {
          // Insert new record
          await client.query(
            `INSERT INTO daily_hourly_consumption 
             (timestamp, hour, kwh, month_name, source_date) 
             VALUES ($1, $2, $3, $4, $5)`,
            [hourTimestamp, hour, kwh, dailyData.month, dateStr]
          );
          insertedCount++;
        } else {
          // Check if new value is higher
          const existingKwh = existingResult.rows[0].kwh;
          if (kwh > existingKwh) {
            await client.query(
              `UPDATE daily_hourly_consumption 
               SET kwh = $1, month_name = $2, source_date = $3, updated_at = NOW() 
               WHERE timestamp = $4 AND hour = $5`,
              [kwh, dailyData.month, dateStr, hourTimestamp, hour]
            );
            updatedCount++;
            console.log(`[db] Updated ${hourTimestamp.toISOString()} hour ${hour}: ${existingKwh} -> ${kwh}`);
          }
        }
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`[db] Saved daily hourly data: ${insertedCount} inserted, ${updatedCount} updated`);
    return { insertedCount, updatedCount };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[db] Error saving daily hourly data:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/* ---------- Close Database Connection ---------- */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[db] Database connection closed');
  }
}

module.exports = {
  initializeSchema,
  saveDailyHourlyData,
  closePool
};
