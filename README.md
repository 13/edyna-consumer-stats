# edyna-consumer-stats

Scrape consumer statistics from the Edyna distributor portal and store them in PostgreSQL.

Prerequisites
- Node.js 25+ and npm (or Docker)
- If the site requires authentication, provide credentials in .env (see below)

Quick start (local)
1. Copy .env.example to .env and edit variables.
2. Install:
   npm install
3. Run one-time scrape:
   npm run scrape
4. Start server + scheduler:
   npm start

Using Docker
- Build & run:
  docker-compose up --build

## Features

### Monthly Data Scraping
Scrapes monthly active energy (kWh) values from the Edyna portal's "Stundenprofil" (hourly profile) view.

### Daily Hourly Data Scraping
After scraping monthly data, the tool automatically:
1. Identifies the most recent month with non-null data
2. Clicks on that month to open the daily view
3. Extracts hourly kWh usage for each day (24-hour breakdown)
4. Saves the data to a JSON file and/or TimescaleDB database

#### Daily Data Output
The daily data is structured as:
```json
{
  "year": 2025,
  "month": "Novembre",
  "days": [
    {
      "date": "01/11/2025",
      "00:00": 0.45,
      "01:00": 0.31,
      "02:00": 0.28,
      ...
      "23:00": 0.52,
      "total_kwh": 12.34
    }
  ]
}
```

### TimescaleDB Integration
The tool can save scraped data directly to a PostgreSQL/TimescaleDB database.

#### Database Setup
1. Create a PostgreSQL/TimescaleDB database
2. Configure database credentials in `.env`:
   ```
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=edyna
   DB_USER=your_user
   DB_PASSWORD=your_password
   DB_SSL=false
   ```

3. Run with database mode:
   ```bash
   npm run start:db
   ```

The tool will:
- Automatically create the required schema and tables
- Create a TimescaleDB hypertable (if TimescaleDB extension is available)
- Insert new hourly consumption data
- **Update existing values if the new value is higher** (overwrite logic)

#### Database Schema
```sql
CREATE TABLE daily_hourly_consumption (
  timestamp TIMESTAMPTZ NOT NULL,
  hour INTEGER NOT NULL,
  kwh DOUBLE PRECISION NOT NULL,
  month_name TEXT,
  source_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (timestamp, hour)
);
```

#### Environment Variables
- `DAILY_OUTPUT_FILE`: Path to save daily usage JSON (default: `daily_usage.json`)
- `DEBUG_SHOTS`: Set to `true` to save screenshots on errors
- `HEADLESS`: Set to `false` to see browser automation
- `DB_HOST`: Database host (default: `localhost`)
- `DB_PORT`: Database port (default: `5432`)
- `DB_NAME`: Database name (default: `edyna`)
- `DB_USER`: Database user (required for DB mode)
- `DB_PASSWORD`: Database password (required for DB mode)
- `DB_SSL`: Enable SSL connection (default: `false`)

## TODO

- [x] Add PostgreSQL/TimescaleDB integration
- [ ] Add Docker/docker-compose
- [ ] Add Cron for scheduled scraping
- [ ] Add unit/integration tests and CI pipeline

