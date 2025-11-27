# edyna-consumer-stats

Scrape consumer statistics from the Edyna distributor portal and store them in PostgreSQL/TimescaleDB.

## Prerequisites
- Node.js 20+ and npm (or Docker)
- If the site requires authentication, provide credentials in .env (see below)

## Quick start (local)
1. Copy .env.example to .env and edit variables.
2. Install:
   ```bash
   npm install
   ```
3. Run one-time scrape:
   ```bash
   npm run start:db
   ```

## Using Docker

The easiest way to run this project is with Docker Compose, which includes:
- The scraper with a cron job (runs daily at 12:00)
- TimescaleDB database

### Setup

1. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   ```
   LOGIN_URL=https://portaledistributore.edyna.net/...
   USERNAME=your_username
   PASSWORD=your_password
   DB_PASSWORD=your_secure_db_password
   ```

3. Start the containers:
   ```bash
   docker-compose up -d --build
   ```

4. View logs:
   ```bash
   docker-compose logs -f edyna-scraper
   ```

### Cron Schedule
The scraper runs automatically every day at **12:00** (noon). You can modify the schedule in the `Dockerfile` by editing the cron expression.

### Manual Run
To run the scraper manually inside the container:
```bash
docker-compose exec edyna-scraper node src/index.js --db
```

## Features

### Monthly Data Scraping
Scrapes monthly active energy (kWh) values from the Edyna portal's "Stundenprofil" (hourly profile) view.

### Daily Hourly Data Scraping
After scraping monthly data, the tool automatically:
1. Identifies the most recent month with non-null data
2. Clicks on that month to open the daily view
3. Extracts hourly kWh usage for each day (24-hour breakdown)
4. Saves the data to TimescaleDB database

#### Daily Data Output
The daily data is structured as:
```json
{
  "year": 2025,
  "month": "Novembre",
  "days": [
    {
      "date": "01/11/2025",
      "hours": {
        "00:00": 0.45,
        "01:00": 0.31,
        ...
        "23:00": 0.52
      },
      "total_kwh": 12.34
    }
  ]
}
```

### TimescaleDB Integration
The tool saves scraped data directly to a PostgreSQL/TimescaleDB database.

#### Database Setup (without Docker)
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
CREATE TABLE edyna_hourly (
  timestamp TIMESTAMPTZ NOT NULL PRIMARY KEY,
  kwh DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Environment Variables
- `LOGIN_URL`: Edyna portal login URL
- `USERNAME`: Portal username
- `PASSWORD`: Portal password
- `DEBUG_SHOTS`: Set to `true` to save screenshots on errors
- `HEADLESS`: Set to `false` to see browser automation (default: `true`)
- `DB_HOST`: Database host (default: `localhost`, use `db` for Docker)
- `DB_PORT`: Database port (default: `5432`)
- `DB_NAME`: Database name (default: `edyna`)
- `DB_USER`: Database user (required for DB mode)
- `DB_PASSWORD`: Database password (required for DB mode)
- `DB_SSL`: Enable SSL connection (default: `false`)

## TODO

- [x] Add PostgreSQL/TimescaleDB integration
- [x] Add Docker/docker-compose
- [x] Add Cron for scheduled scraping
- [ ] Add unit/integration tests and CI pipeline

