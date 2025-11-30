FROM node:25-alpine

# Install only ca-certificates (needed for HTTPS requests)
RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY src ./src
COPY .env.example ./.env.example

# Use node-cron scheduler
CMD ["node", "src/scheduler.js"]
