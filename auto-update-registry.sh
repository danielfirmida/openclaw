#!/bin/bash
# Route 2: Registry-based Auto-Update Script
# Pulls pre-built image from GitHub Container Registry
# More reliable, faster deploys, easy rollback

set -e

OPENCLAW_DIR="/opt/openclaw"
LOG_FILE="/var/log/openclaw-autoupdate.log"
REGISTRY="ghcr.io"
# Replace with your GitHub username/org
GITHUB_USER="${GITHUB_USER:-danielfirmida}"
IMAGE_NAME="${REGISTRY}/${GITHUB_USER}/openclaw:latest"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$OPENCLAW_DIR"

log "Starting registry-based update check..."

# Get current image digest
CURRENT_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE_NAME" 2>/dev/null | cut -d@ -f2 || echo "none")

# Pull latest image
log "Pulling latest image..."
docker pull "$IMAGE_NAME"

# Get new digest
NEW_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE_NAME" | cut -d@ -f2)

if [ "$CURRENT_DIGEST" = "$NEW_DIGEST" ]; then
  log "Already running latest image (${NEW_DIGEST:0:12})"
  exit 0
fi

log "New image available: ${CURRENT_DIGEST:0:12} -> ${NEW_DIGEST:0:12}"

# Update docker-compose to use registry image
export OPENCLAW_IMAGE="$IMAGE_NAME"

# Restart with new image
log "Restarting gateway with new image..."
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

log "Registry update complete"
