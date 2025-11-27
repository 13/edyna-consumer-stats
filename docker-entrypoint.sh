#!/bin/bash
set -e

# Export environment variables for cron
printenv | grep -v "no_proxy" >> /etc/environment

# Start cron daemon
cron

echo "Cron job scheduled: npm run start:db at 12:00 daily"
echo "Tailing cron log..."

# Keep container running and tail the log
tail -f /var/log/cron.log
