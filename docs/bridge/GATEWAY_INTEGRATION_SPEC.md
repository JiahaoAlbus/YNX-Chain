# Bridge Gateway Integration Specification

## Overview

The YNX Bridge coordinator integrates with the canonical App Gateway to ensure consumer products (Wallet, Pay, Exchange, DEX, Finance, Explorer, Monitor, Trust) never receive Bridge service credentials, relayer keys, or unrestricted bridge authority.

## Integration Architecture

```
┌─────────────────┐
│  Browser/Mobile │
│  (Wallet UI)    │
└────────┬────────┘
         │ HTTPS + Session Token
         │ (no Bridge credentials)
         ▼
┌─────────────────┐
│   App Gateway   │
│  (ynx-app-      │
│   gatewayd)     │
└────────┬────────┘
         │ HTTP + Bridge API Key
         │ (loopback only)
         ▼
┌─────────────────┐
│ Bridge Coord    │
│ (ynx-bridged)   │
└─────────────────┘
```

## Session-Based Access (Through Gateway)

### Consumer Request Flow

1. **User authenticates** with App Gateway via ynx1 address + device signature
2. **Gateway issues session token** (hashed, mode 0600 storage, TTL-bound)
3. **Wallet UI calls** `/app/bridge/*` with session token in `X-YNX-App-Session` header
4. **Gateway validates** session, account ownership, device binding, expiry
5. **Gateway forwards** to Bridge coordinator with `X-YNX-Bridge-Key` (service credential)
6. **Bridge responds** with user-scoped data only (filtered by session account)

### Supported Bridge Routes via Gateway

| Route | Method | Access | Scope |
|-------|--------|--------|-------|
| `/bridge/routes` | GET | Public | No auth required, fail-closed catalog |
| `/bridge/assets` | GET | Public | No auth required, token allowlist |
| `/bridge/status` | GET | Public | No auth required, truthful availability |
| `/bridge/transparency` | GET | Public | No auth required, reconciliation evidence |
| `/bridge/transfers` | POST | Protected | `bridge:transfer:create` - create transfer intent |
| `/bridge/transfers` | GET | Protected | `bridge:transfer:read` - list user's transfers only |
| `/bridge/transfers/{id}` | GET | Protected | `bridge:transfer:read` - get transfer if owned by session account |
| `/bridge/transfers/{id}/recovery` | POST | Protected | `bridge:recovery:create` - initiate recovery |
| `/bridge/transfers/{id}/dispute` | POST | Protected | `bridge:dispute:create` - open dispute with evidence |

### Protected Route Authorization

Protected routes enforce:
- Valid Gateway session with `X-YNX-App-Session` header
- Matching `X-YNX-Device-ID` header
- Non-expired session (`expiresAt > now`)
- Session status = `active` (not revoked)
- Account ownership: user can only access their own transfers (filtered by `session.account`)

## Direct API Key Access (Operational)

### Operator/Monitoring Access

Bridge coordinator maintains direct API key authentication for:
- Operational endpoints (pause/resume, reconciliation submission)
- Monitoring/metrics scraping
- Emergency procedures
- Backup/restore operations
- Data export/deletion execution

Direct access is **not exposed through App Gateway** and must use loopback-only binding.

### Operational Routes (API Key Required)

| Route | Method | Purpose |
|-------|--------|---------|
| `/bridge/admin/pause` | POST | Pause new transfers and finalization |
| `/bridge/admin/resume` | POST | Resume after pause with reason |
| `/bridge/admin/reconciliation` | POST | Submit operator reconciliation evidence |
| `/bridge/admin/export` | POST | Export user data with retention hold |
| `/bridge/admin/deletion` | POST | Execute deletion request after retention |
| `/metrics` | GET | Prometheus metrics |

## Gateway Registration

### App Gateway Configuration

Add Bridge to App Gateway upstream services:

```go
// internal/appgateway/gateway.go
func (g *Gateway) upstream(service string) (*url.URL, string, string, bool) {
    switch service {
    case "chat":
        return g.chatURL, g.cfg.ChatAPIKey, "X-YNX-Chat-Key", true
    case "square":
        return g.squareURL, g.cfg.SquareAPIKey, "X-YNX-Square-Key", true
    case "pay":
        return g.payURL, g.cfg.PayAPIKey, "X-YNX-Pay-Key", true
    case "bridge":
        return g.bridgeURL, g.cfg.BridgeAPIKey, "X-YNX-Bridge-Key", true
    default:
        return nil, "", "", false
    }
}
```

### Environment Variables

```bash
# App Gateway
YNX_APP_GATEWAY_BRIDGE_URL=http://127.0.0.1:6440
YNX_APP_GATEWAY_BRIDGE_API_KEY=<generated-key>

# Bridge Coordinator
YNX_BRIDGE_HTTP_ADDR=127.0.0.1:6440
YNX_BRIDGE_API_KEY=<same-generated-key>
YNX_BRIDGE_GATEWAY_SESSION_MODE=enabled
```

## Bridge Coordinator Changes

### Session Validation

Bridge coordinator adds optional Gateway session validation:

```go
// internal/bridgegateway/server.go

type sessionContext struct {
    account       string
    deviceID      string
    authenticated bool
}

func (s *Server) extractSession(r *http.Request) sessionContext {
    if s.cfg.GatewaySessionMode != "enabled" {
        return sessionContext{authenticated: false}
    }
    
    account := strings.TrimSpace(r.Header.Get("X-YNX-Bridge-Session-Account"))
    deviceID := strings.TrimSpace(r.Header.Get("X-YNX-Device-ID"))
    
    if account == "" || deviceID == "" {
        return sessionContext{authenticated: false}
    }
    
    // Gateway already validated session, account, device
    // Bridge trusts Gateway forwarding
    return sessionContext{
        account:       account,
        deviceID:      deviceID,
        authenticated: true,
    }
}
```

### Account-Scoped Queries

```go
func (s *Service) ListTransfers(ctx context.Context, account string, limit int) ([]Transfer, error) {
    // If account is provided (from session), filter by account
    // If account is empty (direct API key), return all (operator view)
    // ...
}
```

## Product Scope Definitions

### Proposed Bridge Scopes

```json
{
  "bridge:quote:read": "Read route quotes and availability",
  "bridge:transfer:create": "Create bridge transfer intents",
  "bridge:transfer:read": "Read user's own transfer history and status",
  "bridge:recovery:create": "Initiate recovery for failed transfers",
  "bridge:dispute:create": "Open disputes with evidence references"
}
```

### Scope Enforcement

Currently: Gateway validates session, Bridge enforces account ownership.

Future enhancement: Gateway can enforce explicit scope grants per session/product.

## Security Boundaries

### What Gateway Protects

✅ Bridge service API key never exposed to browser/mobile  
✅ Session tokens are hashed, time-bound, and revocable  
✅ Account ownership enforced at Gateway and Bridge layers  
✅ Device binding prevents session replay across devices  
✅ Origin/client allowlisting prevents unauthorized products  

### What Bridge Protects

✅ Relayer keys never exposed to Gateway or consumers  
✅ Provider credentials never exposed to Gateway or consumers  
✅ Operational endpoints (pause/reconciliation) require direct API key  
✅ Transfer intents validated for route availability, limits, and policy  
✅ Account ownership re-verified at Bridge layer (defense in depth)  

### What Consumers Never Receive

🚫 Bridge service API key  
🚫 Relayer Ed25519 private keys  
🚫 Provider API credentials  
🚫 Unrestricted withdrawal/mint authority  
🚫 Ability to bypass user approval flow  
🚫 Access to other users' transfer data  

## Deployment Checklist

### Gateway Side

- [ ] Add Bridge to `upstream()` routing table
- [ ] Add `BridgeURL` and `BridgeAPIKey` to Gateway config
- [ ] Update `productRouteAllowed()` for Bridge service
- [ ] Add Bridge routes to `protectedRouteAllowed()` and `publicRouteAllowed()`
- [ ] Update Gateway tests with Bridge session vectors
- [ ] Deploy updated App Gateway with Bridge integration

### Bridge Side

- [ ] Add optional `GatewaySessionMode` config (default: disabled for backward compat)
- [ ] Implement session context extraction from forwarded headers
- [ ] Add account ownership filtering to transfer queries
- [ ] Maintain direct API key auth for operational endpoints
- [ ] Update integration tests with Gateway session vectors
- [ ] Update consumer manifest with `centralGatewayIntegrated: true`

### Consumer Side

- [ ] Update Wallet UI to use `/app/bridge/*` routes through Gateway
- [ ] Include `X-YNX-App-Session` and `X-YNX-Device-ID` headers
- [ ] Remove any direct Bridge API key references (if present)
- [ ] Verify session-based access in consumer integration tests
- [ ] Update consumer documentation with Gateway routing

## Migration Path

### Phase 1: Dual-Mode Bridge (Current)

Bridge accepts:
- Direct API key (for operators, monitoring)
- Gateway-forwarded requests (new, once implemented)

### Phase 2: Gateway-Required for Consumers

Consumer products must route through Gateway.
Direct API key restricted to operational/monitoring use only.

### Phase 3: Explicit Scope Enforcement

Gateway begins enforcing explicit `bridge:*` scope grants.
Sessions without required scopes are rejected.

## Testing

### Gateway Integration Test

```javascript
// scripts/verify/bridge-gateway-integration-check.mjs

test('Bridge routes accessible via Gateway with valid session', async () => {
  // 1. Create Gateway session
  const session = await gateway.createSession(account, device);
  
  // 2. Call /app/bridge/transfers with session token
  const response = await fetch('/app/bridge/transfers', {
    headers: {
      'X-YNX-App-Session': session.token,
      'X-YNX-Device-ID': device.id
    }
  });
  
  expect(response.status).toBe(200);
  // 3. Verify only session account's transfers returned
});

test('Bridge rejects direct consumer access without Gateway', async () => {
  const response = await fetch('http://127.0.0.1:6440/bridge/transfers', {
    headers: { 'X-YNX-Bridge-Key': '<api-key>' }
  });
  // Should require loopback source or Gateway forwarding
});
```

## Evidence Updates

After implementation:

```json
{
  "centralGatewayIntegrated": true,
  "protectedCoordinatorBoundary": {
    "consumerCredentialAccess": false,
    "browserCredentialAccess": false,
    "walletSecretAccess": false,
    "requiredMediator": "canonical-app-gateway",
    "centralGatewayIntegrated": true
  }
}
```

## Summary

Gateway integration ensures consumer products never hold Bridge credentials while maintaining operational access for monitoring and emergency procedures. The integration is backward-compatible (dual-mode) and allows incremental rollout across consumer products.
