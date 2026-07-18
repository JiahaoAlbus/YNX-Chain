# YNX Shop staging operations

## Deployed state

- Buyer: `https://web4.ynxweb4.com/shop-staging/`
- Seller: `https://web4.ynxweb4.com/seller-staging/`
- Health: `https://web4.ynxweb4.com/shop-api-staging/health`
- Version: `https://web4.ynxweb4.com/shop-api-staging/version`
- Service: `ynx-shopd.service`, loopback `127.0.0.1:18095`
- Release: `/opt/ynx-shop/releases/38e2f68deb91d5f26e5aeec2318e260cd0742115`
- Current symlink: `/opt/ynx-shop/current`
- State: `/var/lib/ynx-shop/state.json`, owner `ynx:ynx`, mode `0600`
- Environment: `/etc/ynx/ynx-shopd.env`, owner `root:ynx`, mode `0640`

The service unit is `deploy/shop/ynx-shopd.service`. Caddy routes are `deploy/shop/web4-shop-staging.routes`; `deploy/shop/install-staging-routes.py` adds the import only when the existing Web4 block matches the reviewed shape and creates a timestamped backup before mutation.

## Required secret/config keys

`YNX_SHOP_STATE_HMAC_KEY` is mandatory in staging. The deployed environment also has a Trust API key and public/base URL. Do not put any value in Git or a Web bundle.

The following remain deliberately absent until their owners provision exact reviewed inputs:

- `YNX_SHOP_GATEWAY_URL`, `YNX_SHOP_GATEWAY_KEY`
- `YNX_SHOP_PAY_URL`, `YNX_SHOP_PAY_KEY`, `YNX_SHOP_PAY_MERCHANT_ID`, `YNX_SHOP_PAY_PAYOUT_ADDRESS`
- `YNX_SHOP_AI_URL`, `YNX_SHOP_AI_KEY`

Do not configure Pay with a guessed seller payout. Do not point Wallet at the older App Gateway; the required v2 product registrations and authenticated introspection contract must be deployed first.

## Health, restart, and rollback

```sh
sudo systemctl status ynx-shopd
curl -fsS http://127.0.0.1:18095/health
curl -fsS http://127.0.0.1:18095/version
sudo systemctl restart ynx-shopd
sudo journalctl -u ynx-shopd -n 100 --no-pager
```

The current restart proof preserved the exact SHA-256 of the authenticated state file before/after restart and returned `integrityProtected:true` with source commit `38e2f68deb91d5f26e5aeec2318e260cd0742115`.

Rollback is a symlink switch to a reviewed prior release followed by `systemctl restart`. Preserve `/var/lib/ynx-shop/state.json` and `.bak`; never replace them with an unauthenticated snapshot. Restore a backup only with the same HMAC key and the `-restore-backup` startup flag.

Before changing Caddy, validate `/etc/caddy/Caddyfile`; if validation fails, restore the timestamped `/etc/caddy/ynx-chain.caddy.pre-shop-*` backup. The Shop routes are staging paths under the existing Web4 TLS host and do not replace its fallback service.
