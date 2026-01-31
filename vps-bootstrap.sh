#!/bin/bash
set -e

echo "=== OpenClaw VPS Bootstrap Script ==="
echo "This script sets up Docker, Tailscale, and OpenClaw on a fresh Hetzner VPS"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  print_error "Please run as root"
  exit 1
fi

echo ""
echo "=== Step 1: System Update ==="
apt-get update
apt-get upgrade -y
print_status "System updated"

echo ""
echo "=== Step 2: Install Dependencies ==="
apt-get install -y \
  git \
  curl \
  ca-certificates \
  gnupg \
  lsb-release \
  jq \
  htop \
  unzip
print_status "Dependencies installed"

echo ""
echo "=== Step 3: Install Docker ==="
if command -v docker &> /dev/null; then
  print_warning "Docker already installed, skipping..."
else
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  print_status "Docker installed and started"
fi

# Verify Docker
docker --version
docker compose version
print_status "Docker verified"

echo ""
echo "=== Step 4: Install Tailscale ==="
if command -v tailscale &> /dev/null; then
  print_warning "Tailscale already installed, skipping..."
else
  curl -fsSL https://tailscale.com/install.sh | sh
  print_status "Tailscale installed"
fi

echo ""
echo "=== Step 5: Create Directories ==="
# Main application directory
mkdir -p /opt/openclaw
# Persistent data directory
mkdir -p /opt/openclaw-data
mkdir -p /opt/openclaw-data/workspace
mkdir -p /opt/openclaw-data/credentials
mkdir -p /opt/openclaw-data/agents

# Set permissions (node user in container is UID 1000)
chown -R 1000:1000 /opt/openclaw-data
chmod 700 /opt/openclaw-data
print_status "Directories created with proper permissions"

echo ""
echo "=== Step 6: Clone OpenClaw Repository ==="
cd /opt/openclaw

if [ -d ".git" ]; then
  print_warning "Repository already exists, pulling latest..."
  git pull origin main
else
  # Clone YOUR fork - replace with your repo URL
  # Default to upstream for now
  REPO_URL="${OPENCLAW_REPO_URL:-https://github.com/danielfirmida/openclaw.git}"
  git clone "$REPO_URL" .
  print_status "Repository cloned from $REPO_URL"
fi

echo ""
echo "=== Step 7: Create docker-compose.override.yml ==="
cat > /opt/openclaw/docker-compose.override.yml << 'EOF'
# Override for production deployment
# This file is merged with docker-compose.yml

services:
  openclaw-gateway:
    # Bind ONLY to loopback for security
    ports:
      - "127.0.0.1:${OPENCLAW_GATEWAY_PORT:-18789}:18789"

    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M

    # Health check
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:18789/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

    # Logging configuration
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "3"
EOF
print_status "docker-compose.override.yml created"

echo ""
echo "=== Step 8: Create systemd service for auto-start ==="
cat > /etc/systemd/system/openclaw.service << 'EOF'
[Unit]
Description=OpenClaw Gateway
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/openclaw
ExecStart=/usr/bin/docker compose up -d openclaw-gateway
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable openclaw.service
print_status "Systemd service created and enabled"

echo ""
echo "=== Step 9: Configure Firewall (UFW) ==="
if command -v ufw &> /dev/null; then
  ufw allow ssh
  ufw allow 41641/udp  # Tailscale
  # Note: We do NOT open 18789 - accessed via Tailscale or SSH tunnel
  ufw --force enable
  print_status "Firewall configured (SSH + Tailscale only)"
else
  print_warning "UFW not installed, skipping firewall config"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Bootstrap Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Connect Tailscale:"
echo "   tailscale up"
echo ""
echo "2. Generate secrets and create .env file:"
echo "   cd /opt/openclaw"
echo "   export TOKEN=\$(openssl rand -hex 32)"
echo "   echo \"OPENCLAW_GATEWAY_TOKEN=\$TOKEN\" >> .env"
echo ""
echo "3. Create openclaw.json config in /opt/openclaw-data/"
echo ""
echo "4. Build and start:"
echo "   docker compose build"
echo "   docker compose up -d openclaw-gateway"
echo ""
echo "5. Access via Tailscale: https://YOUR-VPS.tailnet.ts.net/"
echo "   Or SSH tunnel: ssh -N -L 18789:127.0.0.1:18789 root@THIS_VPS"
echo ""
echo "See HETZNER_SETUP.md for detailed instructions."
echo ""
