#!/bin/bash
# Route 1: Git Pull + Rebuild Auto-Update Script
# Runs on the VPS via systemd timer
# Pulls latest code from your fork and rebuilds

set -e

OPENCLAW_DIR="/opt/openclaw"
LOG_FILE="/var/log/openclaw-autoupdate.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$OPENCLAW_DIR"

log "Starting auto-update check..."

# Fetch remote changes
git fetch origin main

# Check if there are new commits
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Already up to date (${LOCAL:0:7})"
  exit 0
fi

log "Updates available: ${LOCAL:0:7} -> ${REMOTE:0:7}"

# Pull changes
log "Pulling changes..."
git pull origin main

# Rebuild image
log "Building new image..."
docker compose build

# Restart gateway
log "Restarting gateway..."
docker compose up -d openclaw-gateway

# Clean up old images
log "Cleaning up old images..."
docker image prune -f

# Verify health
sleep 10
if curl -sf http://127.0.0.1:18789/health > /dev/null; then
  log "Update successful! Gateway healthy."
else
  log "WARNING: Gateway may not be healthy after update"
fi

log "Auto-update complete"
