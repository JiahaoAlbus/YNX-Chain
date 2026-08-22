#!/usr/bin/env bash
set -euo pipefail
readonly APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)" REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
deploy="$APP_ROOT/scripts/pay-public-deploy-p0224.sh" rollback="$APP_ROOT/scripts/pay-public-rollback-p0224.sh"
candidate="$REPO_ROOT/release/pay/ynx-chain-pay-static-5f4ce98e.caddy" old="$REPO_ROOT/release/pay/ynx-chain-pay-static-rollback-p0222.caddy" archive="$REPO_ROOT/release/pay/ynx-pay-web-5f4ce98e-static.tar.gz"
new_fixture(){ fixture="$(mktemp -d)"; mkdir -p "$fixture/etc/caddy" "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1" "$fixture/var/log"; cp "$old" "$fixture/etc/caddy/ynx-chain.caddy"; : >"$fixture/etc/caddy/Caddyfile"; cp "$archive" "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1/candidate.tar.gz"; cp "$candidate" "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1/candidate.caddy"; cp "$old" "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1/rollback.caddy"; }
receipt_field(){ sed -n "s/^$1=//p" "$2"; }

# Normal switch and exact inode-bound cleanup.
new_fixture; stage_id="$(stat -f '%d:%i' "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1")"; PAY_DEPLOY_FIXTURE=1 PAY_DEPLOY_ROOT_PREFIX="$fixture" "$deploy" --remote >"$fixture/receipt"; dev="$(receipt_field dev "$fixture/receipt")"; ino="$(receipt_field ino "$fixture/receipt")"; PAY_DEPLOY_FIXTURE=1 PAY_DEPLOY_ROOT_PREFIX="$fixture" "$rollback" "$dev" "$ino" "${stage_id%%:*}" "${stage_id##*:}" >/dev/null; cmp -s "$old" "$fixture/etc/caddy/ynx-chain.caddy"; [[ ! -e "$fixture/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1" && ! -e "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1" ]]; rm -rf "$fixture"

# Failure before switch cleans the exact created release and preserves config.
new_fixture; printf x >>"$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1/candidate.tar.gz"; if PAY_DEPLOY_FIXTURE=1 PAY_DEPLOY_ROOT_PREFIX="$fixture" "$deploy" --remote >/dev/null 2>&1; then exit 1; fi; cmp -s "$old" "$fixture/etc/caddy/ynx-chain.caddy"; [[ ! -e "$fixture/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1" ]]; rm -rf "$fixture"

# Failure after switch restores config and deletes only the captured release inode.
new_fixture; if PAY_DEPLOY_FIXTURE=1 PAY_DEPLOY_ROOT_PREFIX="$fixture" PAY_FIXTURE_FAIL_AFTER_SWITCH=1 "$deploy" --remote >/dev/null 2>&1; then exit 1; fi; cmp -s "$old" "$fixture/etc/caddy/ynx-chain.caddy"; [[ ! -e "$fixture/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1" ]]; rm -rf "$fixture"

# Replaced-path attack is rejected; replacement directory is preserved.
new_fixture; stage_id="$(stat -f '%d:%i' "$fixture/opt/ynx-pay-web/incoming/pay-web-5f4ce98e-release1")"; PAY_DEPLOY_FIXTURE=1 PAY_DEPLOY_ROOT_PREFIX="$fixture" "$deploy" --remote >"$fixture/receipt"; dev="$(receipt_field dev "$fixture/receipt")"; ino="$(receipt_field ino "$fixture/receipt")"; mv "$fixture/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1" "$fixture/original-release"; mkdir "$fixture/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1"; if PAY_DEPLOY_FIXTURE=1 PAY_DEPLOY_ROOT_PREFIX="$fixture" "$rollback" "$dev" "$ino" "${stage_id%%:*}" "${stage_id##*:}" >/dev/null 2>&1; then exit 1; fi; [[ -d "$fixture/opt/ynx-pay-web/releases/pay-web-5f4ce98e-release1" ]]; cmp -s "$old" "$fixture/etc/caddy/ynx-chain.caddy"; rm -rf "$fixture"

echo 'pay-public-deploy-fixture: pre-switch failure, post-switch rollback, exact cleanup and replaced-path refusal pass'
