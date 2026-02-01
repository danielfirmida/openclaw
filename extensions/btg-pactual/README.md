# BTG Pactual Banking Integration

Read-only access to BTG Pactual business accounts for OpenClaw. Query balances and transactions without write permissions.

## Setup

### 1. Register Application

1. Go to [BTG Pactual Developer Portal](https://developers.empresas.btgpactual.com/)
2. Create an application with these scopes:
   - `accounts:read`
   - `balances:read`
   - `transactions:read`
3. Copy your `client_id`

### 2. Configure Environment

Add to `.env`:

```bash
BTG_CLIENT_ID=your_client_id_here
```

### 3. Authenticate

```bash
openclaw models auth login --provider btg-pactual
```

This opens your browser for OAuth device code flow. Works on VPS/headless servers.

## Tools

### btg_list_accounts

List all accessible BTG Pactual business accounts.

```
"Show my BTG accounts"
```

### btg_get_balance

Get current balance for an account.

```
"What's my balance on account {id}?"
```

### btg_list_transactions

List transactions with date filtering and pagination.

```
"Show transactions from last week"
"List transactions from 2026-01-01 to 2026-01-31"
```

## Security

- **Read-only**: No transfer or payment operations exposed
- **OAuth2 PKCE**: Secure device code flow
- **Token refresh**: Automatic with 15-minute buffer
- **Timeouts**: 15-second request timeout
- **Sandboxed**: Tools disabled in sandboxed agents

## VPS/Docker Deployment

Device code flow works on headless servers. The URL displays in terminal for manual browser access.

For Docker + Tailscale:

```json
{
  "gateway": {
    "trustedProxies": ["172.18.0.1"]
  }
}
```

Find your Docker gateway IP:

```bash
docker network inspect bridge | grep Gateway
```
