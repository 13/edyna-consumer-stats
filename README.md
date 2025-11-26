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

### Daily Hourly Data Scraping (NEW)
After scraping monthly data, the tool automatically:
1. Identifies the most recent month with non-null data
2. Clicks on that month to open the daily view
3. Extracts hourly kWh usage for each day (24-hour breakdown)
4. Saves the data to a JSON file

#### Daily Data Output
The daily data is structured as:
```json
{
  "year": 2025,
  "month": "Novembre",
  "days": [
    {
      "date": "2025-11-01",
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

#### Environment Variables
- `DAILY_OUTPUT_FILE`: Path to save daily usage JSON (default: `daily_usage.json`)
- `DEBUG_SHOTS`: Set to `true` to save screenshots on errors
- `HEADLESS`: Set to `false` to see browser automation

## TODO

- [ ] Add PostgreSQL/TimescaleDB integration
- [ ] Add Docker/docker-compose
- [ ] Add Cron for scheduled scraping
- [ ] Add unit/integration tests and CI pipeline

