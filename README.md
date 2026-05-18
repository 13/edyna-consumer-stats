# edyna-consumer-stats

Scrape consumer statistics from the Edyna distributor portal and store them in PostgreSQL/TimescaleDB.

## Quick start (local)

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. One-time scrape (no database):
   ```bash
   npm start
   ```
4. Scrape and save to database:
   ```bash
   npm run start:db
   ```

## CLI options

```bash
node src/index.js [--db] [--year YYYY] [--month 1-12]
```

| Flag | Description |
|------|-------------|
| `--db` | Save results to the configured database |
| `--year YYYY` | Scrape a specific year (default: current year shown in portal) |
| `--month 1-12` | Scrape a specific month (1 = Jan … 12 = Dec) |

## Docker

The recommended way to run this project is with Docker Compose. The container runs the cron scheduler (`src/scheduler.js`) which handles automatic daily scraping.

### Setup

```bash
cp .env.example .env
# Edit .env with your credentials
docker-compose up -d --build
docker-compose logs -f edyna-scraper
```

### Manual run inside container

```bash
docker-compose exec edyna-scraper node src/index.js --db
```

## Environment variables

All variables are validated at startup — missing required values will print a clear error and exit immediately.

### Required

| Variable | Description |
|----------|-------------|
| `LOGIN_URL` | Full Edyna portal login URL |
| `USERNAME` | Portal username |
| `PASSWORD` | Portal password |

### Database (required when using `--db`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `edyna` | Database name |
| `DB_USER` | — | Database user |
| `DB_PASSWORD` | — | Database password |
| `DB_SSL` | `false` | Enable SSL |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | Verify SSL certificate |

### Scheduler

| Variable | Default | Description |
|----------|---------|-------------|
| `CRON_SCHEDULE` | `0 9 * * *` | Cron expression for daily run |
| `TZ` | `Europe/Rome` | Timezone for cron |
| `RUN_ON_START` | `false` | Run immediately on container start |

### Behaviour

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `true` | Run browser headlessly |
| `DEBUG_SHOTS` | `false` | Save screenshots on scrape errors |
| `SCRAPE_RETRIES` | `3` | Max attempts before giving up |
| `SCRAPE_RETRY_DELAY_MS` | `10000` | Base delay between retries (ms); multiplied per attempt |
| `LOG_LEVEL` | `info` | Pino log level: `debug`, `info`, `warn`, `error` |

## Retry behaviour

The scraper retries the full browser session on failure (network errors, portal timeouts, etc.). With the defaults it makes up to 3 attempts with delays of 10 s, 20 s, and 30 s between them. Tune via `SCRAPE_RETRIES` and `SCRAPE_RETRY_DELAY_MS`.

## Logging

Logs are emitted as JSON via [pino](https://getpino.io). To get human-readable output locally:

```bash
npm install -g pino-pretty
node src/index.js --db | pino-pretty
```

In Docker, the raw JSON is suitable for log aggregators (Loki, Datadog, etc.).

## Scheduler

Two cron jobs run automatically:

- **Daily run** — configurable via `CRON_SCHEDULE` (default: 09:00)
- **Monthly backfill** — runs on the 3rd and 10th of each month at 23:00, scraping the previous full calendar month

## Database schema

```sql
CREATE TABLE edyna_hourly (
  timestamp  TIMESTAMPTZ      NOT NULL PRIMARY KEY,
  kwh        DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ      DEFAULT NOW(),
  updated_at TIMESTAMPTZ      DEFAULT NOW()
);
```

If the TimescaleDB extension is available, the table is automatically converted to a hypertable. Falls back to a regular table otherwise.

Existing records are updated only if the new value is higher (tolerance: 0.001 kWh).

## TODO

- [x] PostgreSQL/TimescaleDB integration
- [x] Docker / docker-compose
- [x] Cron scheduler
- [x] Retry logic with exponential backoff
- [x] Zod env validation
- [x] Structured logging (pino)
- [ ] Unit/integration tests and CI pipeline
