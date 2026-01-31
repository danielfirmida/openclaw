# OpenClaw Hetzner Quick Start

## TL;DR - Deploy in 10 Commands

```bash
# 1. SSH into your new Hetzner VPS (Ubuntu 24.04, Ashburn)
ssh root@YOUR_VPS_IP

# 2. Download and run bootstrap
curl -fsSL https://raw.githubusercontent.com/danielfirmida/openclaw/main/vps-bootstrap.sh | bash

# 3. Connect Tailscale
tailscale up

# 4. Configure environment
cd /opt/openclaw
export TOKEN=$(openssl rand -hex 32)
cat > .env << EOF
OPENCLAW_IMAGE=openclaw:local
OPENCLAW_GATEWAY_TOKEN=$TOKEN
OPENCLAW_GATEWAY_BIND=loopback
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_CONFIG_DIR=/opt/openclaw-data
OPENCLAW_WORKSPACE_DIR=/opt/openclaw-data/workspace
ANTHROPIC_API_KEY=your-key-here
EOF

# 5. Create config
cp openclaw.example.json /opt/openclaw-data/openclaw.json

# 6. Build image
docker compose build

# 7. Start gateway
docker compose up -d openclaw-gateway

# 8. Verify
docker compose logs -f openclaw-gateway

# 9. Access via Tailscale
# Open: https://YOUR-VPS.tailnet.ts.net/

# 10. (Optional) Enable auto-updates
./setup-autoupdate.sh
```

## Access Methods

| Method | Command | URL |
|--------|---------|-----|
| Tailscale | (automatic) | `https://vps.tailnet.ts.net/` |
| SSH Tunnel | `ssh -N -L 18789:127.0.0.1:18789 root@VPS` | `http://127.0.0.1:18789/` |

## Auto-Update Options

| Route | Pros | Cons |
|-------|------|------|
| **1: Git Pull** | Simple, no registry needed | Builds on VPS, slower |
| **2: Registry** | Fast, reproducible, rollback | Needs GitHub Actions setup |

## Security Defaults (Already Applied)

- ✅ Gateway bound to `127.0.0.1` only
- ✅ Token authentication required
- ✅ Tailscale Serve (not Funnel)
- ✅ Sandbox mode: all, scope: session
- ✅ mDNS discovery disabled
- ✅ No ports exposed publicly

## Useful Commands

```bash
# View logs
docker compose logs -f openclaw-gateway

# Restart
docker compose restart openclaw-gateway

# Manual update (Route 1)
git pull && docker compose up -d --build

# Manual update (Route 2)
docker compose pull && docker compose up -d

# Health check
curl http://127.0.0.1:18789/health

# Security audit
docker compose exec openclaw-gateway node dist/index.js security audit
```

## Files Created

```
openclawn/
├── HETZNER_SETUP.md          # Full deployment guide
├── QUICK_START.md            # This file
├── vps-bootstrap.sh          # VPS initial setup script
├── setup-autoupdate.sh       # Auto-update installer
├── auto-update-gitpull.sh    # Route 1: git-based updates
├── auto-update-registry.sh   # Route 2: registry-based updates
├── openclaw-autoupdate.timer # Systemd timer
├── openclaw-autoupdate.service # Systemd service
├── openclaw.example.json     # Sample config
├── .env.example              # Sample environment
└── .github/
    └── workflows/
        └── build-push.yml    # GitHub Actions for Route 2
```
