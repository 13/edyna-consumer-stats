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

