#!/usr/bin/env bash
set -euo pipefail

request_id='P0-WALLET-CHROME-ZIP-PUBLICATION-20260823-01'
expected_ack="${request_id}:ROLLBACK"
: "${YNX_CENTRAL_SINGLE_USE_LEASE_ID:?Central lease ID is required}"
test "${YNX_DOWNLOADS_PUBLICATION_EXECUTION_ACK:-}" = "$expected_ack"

entry='/etc/caddy/Caddyfile'
live='/etc/caddy/conf.d/downloads.ynxweb4.com.caddy'
downloads='/opt/ynx/public-downloads'
wallet="$downloads/wallet"
stage="$downloads/.${request_id}.stage"
receipt="$stage/created-identities.receipt"
target_dir="$wallet/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d"
target="$target_dir/ynx-wallet-chrome-edge-0.1.0.zip"
backup="${live}.rollback-${request_id}"
restore="${live}.restore-${request_id}"

test "$(stat -Lc '%u:%g:%a' "$receipt")" = '0:0:400'
mapfile -t receipt_lines < "$receipt"
test "${#receipt_lines[@]}" = '4'
for line in "${receipt_lines[@]}"; do
  [[ "$line" =~ ^(TARGET|TARGET_DIR|LIVE_CONFIG|BACKUP_CONFIG)\ [0-9]+\ [0-9]+\ [0-9]+\ [0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]]
done

expected_target="${receipt_lines[0]#TARGET }"
expected_target_dir="${receipt_lines[1]#TARGET_DIR }"
expected_live="${receipt_lines[2]#LIVE_CONFIG }"
expected_backup="${receipt_lines[3]#BACKUP_CONFIG }"
test "$(stat -Lc '%d %i %u %g %a %h %s' "$target")" = "$expected_target"
test "$(stat -Lc '%d %i %u %g %a %h %s' "$target_dir")" = "$expected_target_dir"
test "$(stat -Lc '%d %i %u %g %a %h %s' "$live")" = "$expected_live"
test "$(stat -Lc '%d %i %u %g %a %h %s' "$backup")" = "$expected_backup"
test "$(sha256sum "$target" | awk '{print $1}')" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
test "$(sha256sum "$live" | awk '{print $1}')" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'
test "$(sha256sum "$backup" | awk '{print $1}')" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f'
test "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = '1'
test ! -e "$restore"

/usr/bin/unlink "$target"
/usr/bin/rmdir "$target_dir"
test ! -e "$target"
test ! -e "$target_dir"

/usr/bin/ln -- "$backup" "$restore"
/usr/bin/mv -T -- "$restore" "$live"
/usr/bin/caddy validate --config "$entry" --adapter caddyfile
/usr/bin/systemctl reload caddy
/usr/bin/systemctl is-active --quiet caddy
test "$(sha256sum "$live" | awk '{print $1}')" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f'
printf 'ROLLED_BACK_PENDING_PUBLIC_ABSENCE_GATE request=%s lease=%s\n' "$request_id" "$YNX_CENTRAL_SINGLE_USE_LEASE_ID"
