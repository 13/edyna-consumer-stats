FROM node:24-alpine

# Chromium + deps for Puppeteer; tini as PID 1 to reap Chromium zombies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    tzdata \
    tini

ENV TZ=Europe/Rome
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Use system Chromium instead of the bundled download
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

USER node

# Scheduler touches /tmp/edyna-heartbeat every 60s; stale file = dead event loop
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD sh -c '[ $(( $(date +%s) - $(stat -c %Y /tmp/edyna-heartbeat 2>/dev/null || echo 0) )) -lt 300 ]'

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/scheduler.js"]
