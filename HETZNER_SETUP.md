# OpenClaw Hetzner Deployment Guide

## Overview

This guide deploys OpenClaw on a Hetzner VPS (~$5/month) with:
- Docker-based deployment with persistent state
- Loopback-only gateway (secure by default)
- Tailscale Serve for remote access (or SSH tunnel fallback)
- Sandbox isolation for tools
- Auto-update options

## Recommended VPS Specs

- **Location**: Ashburn (US East) - best latency from Brazil
- **Type**: CX22 or CX32 (2-4 vCPUs, 4-8GB RAM)
- **OS**: Ubuntu 24.04 LTS or Debian 12

---

## Part 1: Initial VPS Setup

### 1.1 Create VPS on Hetzner

1. Go to https://console.hetzner.cloud
2. Create new project → Add server
3. Location: **Ashburn**
4. Image: **Ubuntu 24.04**
5. Type: **CX22** (€4.35/mo) or **CX32** for heavier workloads
6. Add your SSH key
7. Create & Start

### 1.2 SSH into your VPS

```bash
ssh root@YOUR_VPS_IP
```

### 1.3 Run the bootstrap script

Copy the entire `vps-bootstrap.sh` script to your VPS and run:

```bash
chmod +x vps-bootstrap.sh
./vps-bootstrap.sh
```

This installs Docker, Tailscale, creates directories, and clones OpenClaw.

---

## Part 2: Configuration

### 2.1 Generate secrets

```bash
cd /opt/openclaw

# Generate gateway token
export OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
echo "OPENCLAW_GATEWAY_TOKEN=$OPENCLAW_GATEWAY_TOKEN"

# Generate keyring password (for Gmail/OAuth)
export GOG_KEYRING_PASSWORD=$(openssl rand -hex 32)
echo "GOG_KEYRING_PASSWORD=$GOG_KEYRING_PASSWORD"
```

### 2.2 Create .env file

```bash
cat > .env << 'EOF'
# OpenClaw Configuration
OPENCLAW_IMAGE=openclaw:local
OPENCLAW_GATEWAY_TOKEN=REPLACE_WITH_YOUR_TOKEN
OPENCLAW_GATEWAY_BIND=loopback
OPENCLAW_GATEWAY_PORT=18789

# Persistent directories (on host)
OPENCLAW_CONFIG_DIR=/opt/openclaw-data
OPENCLAW_WORKSPACE_DIR=/opt/openclaw-data/workspace

# OAuth/Gmail keyring (optional)
GOG_KEYRING_PASSWORD=REPLACE_WITH_YOUR_PASSWORD

# Model authentication (add your keys)
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
EOF
```

Replace the `REPLACE_WITH_*` values with your generated secrets.

### 2.3 Configure openclaw.json

```bash
cat > /opt/openclaw-data/openclaw.json << 'EOF'
{
  "gateway": {
    "bind": "loopback",
    "port": 18789,
    "auth": {
      "mode": "token"
    },
    "tailscale": {
      "mode": "serve"
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-5"
      },
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "workspaceAccess": "rw",
        "network": "none"
      },
      "tools": {
        "deny": []
      }
    }
  },
  "logging": {
    "redactSensitive": "tools"
  }
}
EOF
```

---

## Part 3: Tailscale Setup (Recommended)

### 3.1 Login to Tailscale

```bash
tailscale up
```

Follow the link to authenticate. Your VPS joins your tailnet.

### 3.2 Enable HTTPS on your tailnet

1. Go to https://login.tailscale.com/admin/dns
2. Enable **MagicDNS**
3. Enable **HTTPS Certificates**

### 3.3 Verify Tailscale status

```bash
tailscale status
```

Your VPS should show with a MagicDNS name like `vps-name.tailnet-name.ts.net`

---

## Part 4: Build and Run

### 4.1 Build the image

```bash
cd /opt/openclaw
docker compose build
```

### 4.2 Start the gateway

```bash
docker compose up -d openclaw-gateway
```

### 4.3 Check logs

```bash
docker compose logs -f openclaw-gateway
```

You should see: `Gateway listening on 127.0.0.1:18789`

### 4.4 Verify Tailscale Serve

After startup, OpenClaw auto-configures Tailscale Serve. Verify with:

```bash
tailscale serve status
```

Access via: `https://YOUR-VPS.tailnet-name.ts.net/`

---

## Part 5: Access Methods

### Option A: Tailscale (Recommended)

From any device on your tailnet:
```
https://YOUR-VPS.tailnet-name.ts.net/
```

### Option B: SSH Tunnel (Fallback)

From your local machine:
```bash
ssh -N -L 18789:127.0.0.1:18789 root@YOUR_VPS_IP
```

Then access: `http://127.0.0.1:18789/`

---

## Part 6: Auto-Update Options

Choose one of these approaches:

### Route 1: Git Pull + Rebuild (Simple)

Best for: Development, quick iteration

See `auto-update-gitpull.sh` and `openclaw-autoupdate.timer`

### Route 2: GitHub Actions + Registry (Recommended for Production)

Best for: Reproducible builds, rollback capability

See `auto-update-registry.sh` and `.github/workflows/build-push.yml`

---

## Security Checklist

- [ ] Gateway bound to loopback only
- [ ] Strong gateway token generated
- [ ] Tailscale Serve configured (not Funnel for personal use)
- [ ] Sandbox mode: "all" with scope: "session"
- [ ] File permissions: 600 for configs, 700 for directories
- [ ] No ports exposed on 0.0.0.0
- [ ] Run `openclaw security audit` after setup

---

## Maintenance Commands

```bash
# View logs
docker compose logs -f openclaw-gateway

# Restart gateway
docker compose restart openclaw-gateway

# Update and rebuild
cd /opt/openclaw && git pull && docker compose up -d --build

# Check gateway status
curl -s http://127.0.0.1:18789/health

# Security audit (from container)
docker compose exec openclaw-gateway node dist/index.js security audit
```

---

## Troubleshooting

### Gateway won't start
```bash
docker compose logs openclaw-gateway
# Check for config errors, missing env vars
```

### Tailscale Serve not working
```bash
tailscale serve status
# Ensure MagicDNS and HTTPS are enabled on tailnet
```

### Permission denied errors
```bash
chown -R 1000:1000 /opt/openclaw-data
chmod 700 /opt/openclaw-data
chmod 600 /opt/openclaw-data/openclaw.json
```
