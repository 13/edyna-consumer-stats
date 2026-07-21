# edyna-consumer-stats

Scrape consumer statistics from the Edyna distributor portal and store them in PostgreSQL/TimescaleDB.

Requires Node.js >= 22.9 (uses `--env-file-if-exists` and native ESM).

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

`.env` is loaded automatically via Node's built-in `--env-file-if-exists` — no dotenv dependency.

## CLI options

```bash
node --env-file-if-exists=.env src/index.js [--db] [--year YYYY] [--month 1-12]
```

| Flag | Description |
|------|-------------|
| `--db` | Save results to the configured database |
| `--year YYYY` | Scrape a specific year (default: current year shown in portal) |
| `--month 1-12` | Scrape a specific month (1 = Jan … 12 = Dec) |

## Docker

The recommended way to run this project is with Docker Compose. The container runs the cron scheduler (`src/scheduler.js`) which handles automatic daily scraping. The image runs as the non-root `node` user with `tini` as PID 1, and exposes a `HEALTHCHECK` based on a scheduler heartbeat file.

### Setup

```bash
cp .env.example .env
# Edit .env with your credentials
docker compose up -d --build
docker compose logs -f edyna-scraper
```

### Manual run inside container

```bash
docker compose exec edyna-scraper node src/index.js --db
```

## Environment variables

All variables are validated at startup — missing required values will print a clear error and exit immediately.

### Required

| Variable | Description |
|----------|-------------|
| `LOGIN_URL` | Full Edyna portal login URL |
| `EDYNA_USERNAME` | Portal username |
| `EDYNA_PASSWORD` | Portal password |

> **Migrating from < 0.3.0:** `USERNAME`/`PASSWORD` were renamed to `EDYNA_USERNAME`/`EDYNA_PASSWORD` to avoid collisions with the shell's own `USERNAME` variable.

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
| `TZ` | `Europe/Rome` | Timezone for cron and scraped timestamps |
| `RUN_ON_START` | `false` | Run immediately on container start |

### Behaviour

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADLESS` | `true` | Run browser headlessly |
| `DEBUG_SHOTS` | `false` | Save screenshots on scrape errors |
| `SCREENSHOT_DIR` | OS temp dir | Directory for debug screenshots |
| `SCRAPE_RETRIES` | `3` | Max attempts before giving up |
| `SCRAPE_RETRY_DELAY_MS` | `10000` | Base delay between retries (ms); multiplied per attempt |
| `LOG_LEVEL` | `info` | Pino log level: `debug`, `info`, `warn`, `error` |

## Retry behaviour

The scraper retries the full browser session on failure (network errors, portal timeouts, etc.). With the defaults it makes up to 3 attempts with delays of 10 s, 20 s, and 30 s between them. Tune via `SCRAPE_RETRIES` and `SCRAPE_RETRY_DELAY_MS`.

## Logging

Logs are emitted as JSON via [pino](https://getpino.io). To get human-readable output locally:

```bash
npm install -g pino-pretty
npm run start:db | pino-pretty
```

In Docker, the raw JSON is suitable for log aggregators (Loki, Datadog, etc.).

## Scheduler

Two cron jobs run automatically:

- **Daily run** — configurable via `CRON_SCHEDULE` (default: 09:00)
- **Monthly backfill** — runs on the 3rd and 10th of each month at 23:00, scraping the previous full calendar month

Overlapping triggers are skipped while a run is in progress. On `SIGINT`/`SIGTERM` the scheduler waits for the in-flight run to finish before exiting.

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

Writes are a single batched upsert; a row is only touched when the scraped value actually differs from the stored one (`IS DISTINCT FROM`), so corrections in either direction are applied and `updated_at` only moves on real changes.

### DST handling

Hourly columns are interpreted as consecutive hours after local midnight (in `TZ`), not wall-clock labels. On the 25-hour October day both occurrences of 02:00 get distinct timestamps; the 23-hour March day produces no phantom hour.

## Development

```bash
npm run lint   # ESLint
npm test       # node:test unit tests (test/)
```

CI runs lint + tests on every push/PR; tagged releases (`v*`) build and publish a multi-arch (amd64/arm64) Docker image to GHCR.
