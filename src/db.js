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

// Constants
const HOURS_PER_DAY = 24;

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
      // SSL configuration - WARNING: rejectUnauthorized: false disables certificate validation
      // This should only be used in development. For production, use proper SSL certificates.
      ssl: process.env.DB_SSL === 'true' ? { 
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' 
      } : false
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
      
      // Insert/update each hour using UPSERT with overwrite condition
      // Hours are in a nested object (day.hours['00:00'], day.hours['01:00'], etc.)
      for (let h = 0; h < HOURS_PER_DAY; h++) {
        const hourLabel = `${String(h).padStart(2, '0')}:00`;
        const kwh = day.hours[hourLabel];
        
        if (kwh === null || kwh === undefined) continue;
        
        // Create timestamp for this specific hour
        const recordTimestamp = new Date(timestamp);
        recordTimestamp.setHours(h, 0, 0, 0);
        
        // Check if record exists and get current value
        const existingResult = await client.query(
          'SELECT kwh FROM daily_hourly_consumption WHERE timestamp = $1 AND hour = $2',
          [recordTimestamp, h]
        );
        
        const existingKwh = existingResult.rows.length > 0 ? existingResult.rows[0].kwh : null;
        const shouldUpdate = existingKwh === null || (kwh - existingKwh > 0.001);
        
        if (!shouldUpdate) {
          // Skip - existing value is higher or equal (within tolerance)
          continue;
        }
        
        // Use UPSERT to insert or update
        await client.query(
          `INSERT INTO daily_hourly_consumption 
           (timestamp, hour, kwh, month_name, source_date) 
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (timestamp, hour) 
           DO UPDATE SET 
             kwh = EXCLUDED.kwh,
             month_name = EXCLUDED.month_name,
             source_date = EXCLUDED.source_date,
             updated_at = NOW()`,
          [recordTimestamp, h, kwh, dailyData.month, dateStr]
        );
        
        if (existingKwh === null) {
          insertedCount++;
        } else {
          updatedCount++;
          console.log(`[db] Updated ${recordTimestamp.toISOString()} hour ${h}: ${existingKwh} -> ${kwh} kWh`);
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
