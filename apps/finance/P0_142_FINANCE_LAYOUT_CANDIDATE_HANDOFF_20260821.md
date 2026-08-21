# P0-142 Finance layout-corrected candidate — source-only

P0-141 is not reusable. This P0-142 candidate corrects only the false release-layout assumption that stopped P0-141; it performs no production action and grants no deployment authority.

## Authoritative tracked layout

Tracked deployment evidence from `3b2383f5c18ab3eb5ce7f7f6a267d2cfe7c7e6a4` establishes:

- release directory: `/opt/ynx/releases/finance/ynx-finance-50892538dc23`
- executable: `/opt/ynx/releases/finance/ynx-finance-50892538dc23/ynx-finance` — **not** `bin/ynx-finance`
- active pointer and unit start: `/opt/ynx/finance-current` → `ExecStart=/opt/ynx/finance-current/ynx-finance`
- unit working directory: `/opt/ynx/finance-current`
- served assets: `/opt/ynx/finance-current/web`; loopback listener: `127.0.0.1:6483`

The tracked service/unit and deploy-script blob identities are recorded in [P0-142 evidence](evidence/p0-142-finance-layout-candidate-20260821.json).

## Frozen candidate

- Source: `50892538dc237ef519d95c491f4b918a125a6c8e` / tree `bd83a62e63cce0db7435c79e7b6dd0f116788f76`
- Local offline package: `ynx-finance-50892538dc23-p0142-layout-candidate.tar.gz`
- Archive: 3,938,711 bytes, SHA-256 `a3df3d90c344bdfd4b49d89ad3e1d08f838f4d277b01c96aada18997e0ad0593`
- Root executable: 8,573,112 bytes, SHA-256 `9e7bf2d588a3a87ddc8e4a2c254e85e38972540efd167e96743f5cd63e93584a`
- Package contains the executable, seven Web assets, CycloneDX SBOM, and `SHA256SUMS`.

Two Linux amd64 builds were byte-identical. A local two-start `/version` test returns this commit and `ynx-finance-50892538dc23` consistently. The candidate is not hosted, installed, signed, deployed, or publicly bound.

## Future lease-only preflight and rollback

The next lease must first bind the real existing target, service unit, environment and Caddy hashes again. Before any write, its operator must require:

```sh
set -euo pipefail
current=/opt/ynx/finance-current
previous=$(readlink -f "$current")
release=/opt/ynx/releases/finance/ynx-finance-50892538dc23
test "$(uname -m)" = x86_64
test -d "$previous" && test ! -L "$previous"
test -r "$previous/ynx-finance" && test -x "$previous/ynx-finance"
test "$(systemctl show ynx-finance -p WorkingDirectory --value)" = /opt/ynx/finance-current
systemctl cat ynx-finance | grep -Fqx 'ExecStart=/opt/ynx/finance-current/ynx-finance'
test -f /etc/ynx/finance.env
grep -Fqx 'YNX_FINANCE_WEB_DIR=/opt/ynx/finance-current/web' /etc/ynx/finance.env
stage=$(mktemp -d /opt/ynx/releases/finance/.finance-p0142.XXXXXX)
tar -xzf "$approved_archive" -C "$stage"
candidate_dir="$stage/$(basename "$release")"
test -d "$candidate_dir" && test ! -L "$candidate_dir"
test -r "$candidate_dir/ynx-finance" && test -x "$candidate_dir/ynx-finance"
(cd "$candidate_dir" && sha256sum -c SHA256SUMS)
```

Only after those checks and the new lease's exact archive/hash verification may the operator atomically point `current` to `release`. If any post-switch local/public health or version check fails, rollback is exactly:

```sh
ln -sfn "$previous" /opt/ynx/finance-current.rollback
mv -Tf /opt/ynx/finance-current.rollback /opt/ynx/finance-current
systemctl daemon-reload
systemctl restart ynx-finance
```

The old runtime/public truth remains the P0-141 fail-closed baseline. No Wallet approval, Product Session, signature, transaction or ComputerControl status is implied by this candidate.
