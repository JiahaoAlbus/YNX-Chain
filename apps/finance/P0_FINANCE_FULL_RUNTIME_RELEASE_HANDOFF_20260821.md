# Finance full-runtime release candidate — source-only

This is a complete offline **Linux amd64** Finance release candidate. It is not installed, uploaded, signed, deployed, or publicly verified. No SSH, Wallet click, account request, or external service request was made while preparing it.

## Immutable candidate

- Source commit/tree: `50892538dc237ef519d95c491f4b918a125a6c8e` / `bd83a62e63cce0db7435c79e7b6dd0f116788f76`
- Release directory: `/opt/ynx/releases/finance/ynx-finance-50892538dc237ef519d95c491f4b918a125a6c8e`
- Offline archive: `ynx-finance-50892538dc237ef519d95c491f4b918a125a6c8e-offline-complete-linux-amd64.tar.gz`
- Archive SHA-256 / bytes: `d35f2e155ae3802b07048dd6f045b63ba477adeb1b12bc381d6e170294290915` / `6812744`
- Runtime binary SHA-256 / bytes: `39b97d6cea11bc53bf1f918e6b3ea4257c19672ba671a1fb73d14e3420169ce3` / `11965655`
- SBOM: [ynx-finance-50892538-sbom.cdx.json](evidence/ynx-finance-50892538-sbom.cdx.json)
- Full inventory, scans, local `/version` restart validation, and rollback binding: [release evidence](evidence/p0-finance-full-runtime-release-candidate-20260821.json)

The binary was independently built twice with `CGO_ENABLED=0`, `-trimpath`, fixed source date, and source identity linker flags; the two Linux amd64 outputs were byte-identical. Its local `/version` response, including a second launch, identifies this exact commit and release. The remote host has been authoritatively read as `x86_64`; no arm64 binary is a deploy candidate.

## Current public truth and rollback

The current service remains untouched:

- `/opt/ynx/finance-current` → `/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a`
- Public `/version`: commit `3b2383f5c18ab3eb5ce7f7f6a267d2cfe7c7e6a4`, 130 bytes, SHA-256 `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226`
- Current binary, environment, systemd unit, and Caddy hashes are pinned in the evidence. Any mismatch is a fail-closed release blocker.

## One-time lease runbook — do not execute before approval

The explicit one-time deployment lease must provide the approved archive location and attest the existing environment, unit, and Caddy file paths. Those paths are intentionally not guessed here; this release changes neither configuration nor Caddy.

```sh
set -euo pipefail
release=/opt/ynx/releases/finance/ynx-finance-50892538dc237ef519d95c491f4b918a125a6c8e
previous=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
archive=/approved/ynx-finance-50892538dc237ef519d95c491f4b918a125a6c8e-offline-complete-linux-amd64.tar.gz
expected_archive=d35f2e155ae3802b07048dd6f045b63ba477adeb1b12bc381d6e170294290915
test "$(uname -m)" = x86_64
test "$(sha256sum "$archive" | awk '{print $1}')" = "$expected_archive"
test "$(readlink -f /opt/ynx/finance-current)" = "$previous"
test "$(sha256sum "$previous/bin/ynx-finance" | awk '{print $1}')" = 0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f
: "${ATTESTED_FINANCE_ENV_PATH:?lease must provide the already-read environment path}"
: "${ATTESTED_FINANCE_UNIT_PATH:?lease must provide the already-read systemd unit path}"
: "${ATTESTED_CADDY_PATH:?lease must provide the already-read Caddy path}"
test "$(sha256sum "$ATTESTED_FINANCE_ENV_PATH" | awk '{print $1}')" = 854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252
test "$(sha256sum "$ATTESTED_FINANCE_UNIT_PATH" | awk '{print $1}')" = 2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b
test "$(sha256sum "$ATTESTED_CADDY_PATH" | awk '{print $1}')" = dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282
stage=$(mktemp -d /opt/ynx/releases/finance/.finance-stage.XXXXXX)
tar -xzf "$archive" -C "$stage"
test "$(sha256sum "$stage/$(basename "$release")/bin/ynx-finance" | awk '{print $1}')" = 39b97d6cea11bc53bf1f918e6b3ea4257c19672ba671a1fb73d14e3420169ce3
mv "$stage/$(basename "$release")" "$release"
next=/opt/ynx/finance-current.next
ln -s "$release" "$next"
mv -Tf "$next" /opt/ynx/finance-current
systemctl restart ynx-finance
systemctl is-active --quiet ynx-finance
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:6483/version | sha256sum | awk '{print $1}' | grep -Fx fd7c2b34b1ae45a6e47d97caecac5407661aff2d4a2daf3efd081b66418ab9b2
curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/version | sha256sum | awk '{print $1}' | grep -Fx fd7c2b34b1ae45a6e47d97caecac5407661aff2d4a2daf3efd081b66418ab9b2
```

If a switch, service check, local `/version`, or public `/version` check fails, restore only the prior symlink and restart the unchanged service:

```sh
rollback=/opt/ynx/finance-current.rollback
ln -s /opt/ynx/releases/finance/ynx-finance-3b2383f5c18a "$rollback"
mv -Tf "$rollback" /opt/ynx/finance-current
systemctl restart ynx-finance
systemctl is-active --quiet ynx-finance
curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/version | sha256sum | awk '{print $1}' | grep -Fx 39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226
```

The raw Go binary contains a standard-library `localhost` string and Finance source contains one loopback validation comparison. Neither provides an endpoint; served Web assets and runtime source contain no `http(s)://localhost`, bare `ynxwallet://authorize`, or direct browser RPC fetch. These facts are recorded rather than suppressed.
