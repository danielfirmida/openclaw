#!/bin/bash
# Install auto-update timer on VPS
# Run this on your Hetzner VPS after bootstrap

set -e

echo "=== Installing OpenClaw Auto-Update ==="

# Copy scripts
cp /opt/openclaw/auto-update-gitpull.sh /opt/openclaw/
cp /opt/openclaw/auto-update-registry.sh /opt/openclaw/
chmod +x /opt/openclaw/auto-update-*.sh

# Choose your route
echo ""
echo "Which auto-update method do you want to use?"
echo "1) Git Pull + Rebuild (simpler, builds on VPS)"
echo "2) Registry Pull (recommended, pre-built images)"
echo ""
read -p "Enter choice [1/2]: " ROUTE

if [ "$ROUTE" = "2" ]; then
  # Configure for registry-based updates
  read -p "Enter your GitHub username: " GITHUB_USER
  echo "GITHUB_USER=$GITHUB_USER" >> /opt/openclaw/.env

  # Update service to use registry script
  sed -i 's|auto-update-gitpull.sh|auto-update-registry.sh|' /etc/systemd/system/openclaw-autoupdate.service

  # Login to GHCR (needs PAT with read:packages scope)
  echo "You'll need to create a GitHub Personal Access Token (PAT) with 'read:packages' scope"
  echo "Create one at: https://github.com/settings/tokens"
  read -p "Enter your GitHub PAT: " GITHUB_TOKEN
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

  echo "Configured for registry-based updates"
else
  echo "Configured for git pull updates"
fi

# Install systemd units
cp /opt/openclaw/openclaw-autoupdate.service /etc/systemd/system/
cp /opt/openclaw/openclaw-autoupdate.timer /etc/systemd/system/

# Enable and start timer
systemctl daemon-reload
systemctl enable openclaw-autoupdate.timer
systemctl start openclaw-autoupdate.timer

echo ""
echo "=== Auto-Update Installed ==="
echo ""
echo "Timer status:"
systemctl status openclaw-autoupdate.timer --no-pager

echo ""
echo "To check update logs:"
echo "  tail -f /var/log/openclaw-autoupdate.log"
echo ""
echo "To manually trigger an update:"
echo "  systemctl start openclaw-autoupdate.service"
echo ""
