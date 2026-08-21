# Finance runtime PREPARE — no production write

This handoff freezes a Finance-only static Web candidate from remote-read back commit `88958904ac232421853fefc1edad522272afbd35` (tree `c3be5cac93f525679e871e3b8807fe705c672ab6`). It does not deploy, switch a symlink, restart `ynx-finance`, click a Wallet button, request an account, create a session, sign, or transact.

## Frozen candidate

- Archive: `/tmp/ynx-finance-prepare.xo9DHm/ynx-finance-88958904ac232421853fefc1edad522272afbd35-web-static.tar.gz`
- SHA-256: `5b08fd2ae15a7add0dc479e166bd8756c5df87e5ac42676248fec414a2191a31`
- Bytes: `123411`
- Target release: `/opt/ynx/releases/finance/ynx-finance-88958904ac232421853fefc1edad522272afbd35`
- Current rollback target: `/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a` via `/opt/ynx/finance-current`
- Public ingress: `https://finance.ynxweb4.com/` → Caddy → `127.0.0.1:6483` → `ynx-finance`.

The archive contains only seven served Web assets and the full per-file blob, byte, and SHA-256 inventory is in [p0-finance-runtime-prepare-20260821.json](evidence/p0-finance-runtime-prepare-20260821.json). `health.json` is deliberately excluded: it declares an older implementation commit and must not substitute for service health. The package is clear of literal `localhost`, naked `ynxwallet://authorize`, direct browser fetches to `rpc.ynxweb4.com/evm`, private-key markers, and common cloud-credential markers.

## Deliberate runtime boundary

The exact Finance recovery tree has `apps/finance/cmd/server`, but lacks its imported `internal/finance` package. It cannot produce a source-bound `ynx-finance` binary. The frozen artifact is therefore a **static Web candidate only**, not a deployable complete runtime. Copying the existing rollback binary would make the Web asset source-bound but leave the process binary unbound, so it is forbidden for this release.

Integration must supply a provenance-verified binary build input for the exact source before granting a write lease. Do not substitute an arbitrary workspace or the current rollback binary.

## One-time lease runbook

After the binary provenance is accepted and an explicit one-time lease is issued, use these commands only with the exact reviewed artifact and release path:

```sh
set -euo pipefail
release=/opt/ynx/releases/finance/ynx-finance-88958904ac232421853fefc1edad522272afbd35
previous=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
archive=/approved/ynx-finance-88958904ac232421853fefc1edad522272afbd35-web-static.tar.gz
expected=5b08fd2ae15a7add0dc479e166bd8756c5df87e5ac42676248fec414a2191a31
test "$(shasum -a 256 "$archive" | awk '{print $1}')" = "$expected"
test "$(readlink -f /opt/ynx/finance-current)" = "$previous"
test -x "$release/bin/ynx-finance"  # provenance-verified binary is required
stage=$(mktemp -d /opt/ynx/releases/finance/.prepare.XXXXXX)
tar -xzf "$archive" -C "$stage"
install -d -m 0755 "$release/web"
cp -R "$stage/web/apps/finance/web/." "$release/web/"
test "$(shasum -a 256 "$release/web/wallet-connect.js" | awk '{print $1}')" = 44a2054a7f58bf0458ff466a3f9c4d1a391adab20c321fef74977e8fa2fd4690
```

Only after the lease holder supplies and verifies the source-bound binary may it execute this switch-and-check sequence. It is a future runbook, not an action taken by this PREPARE checkpoint:

```sh
# Requires the one-time deployment lease and a binary provenance record for $release/bin/ynx-finance.
next=/opt/ynx/finance-current.next
ln -s "$release" "$next"
mv -Tf "$next" /opt/ynx/finance-current
systemctl restart ynx-finance
systemctl is-active --quiet ynx-finance
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:6483/api/health
curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/ >/dev/null
curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/wallet-connect.js \
  | shasum -a 256 | awk '{print $1}' \
  | grep -Fx 44a2054a7f58bf0458ff466a3f9c4d1a391adab20c321fef74977e8fa2fd4690
```

The binary's health response must also identify the approved source/build record before this can be called source-bound public runtime. If any service-health, served-byte, or binary-source-identity check fails, the lease holder must restore the prior release:

```sh
# Rollback only after a failed leased deployment; this PREPARE did not execute it.
rollback=/opt/ynx/finance-current.rollback
ln -s "$previous" "$rollback"
mv -Tf "$rollback" /opt/ynx/finance-current
systemctl restart ynx-finance
systemctl is-active --quiet ynx-finance
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:6483/api/health
```

Do not use a browser RPC probe or Wallet account request as a deployment health check.
