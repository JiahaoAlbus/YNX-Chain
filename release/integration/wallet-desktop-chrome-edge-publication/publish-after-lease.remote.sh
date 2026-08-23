#!/usr/bin/env bash
set -euo pipefail

request_id='P0-WALLET-CHROME-ZIP-PUBLICATION-20260823-01'
expected_ack="${request_id}:EXECUTE"
: "${YNX_CENTRAL_SINGLE_USE_LEASE_ID:?Central lease ID is required}"
test "${YNX_DOWNLOADS_PUBLICATION_EXECUTION_ACK:-}" = "$expected_ack"

entry='/etc/caddy/Caddyfile'
live='/etc/caddy/conf.d/downloads.ynxweb4.com.caddy'
downloads='/opt/ynx/public-downloads'
wallet="$downloads/wallet"
stage="$downloads/.${request_id}.stage"
uploaded_zip="$stage/ynx-wallet-chrome-edge-0.1.0.zip.upload"
uploaded_caddy="$stage/downloads.ynxweb4.com.chrome-edge.candidate.caddy.upload"
receipt="$stage/created-identities.receipt"
target_dir="$wallet/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d"
target="$target_dir/ynx-wallet-chrome-edge-0.1.0.zip"
backup="${live}.rollback-${request_id}"
next="${live}.next-${request_id}"
restore="${live}.restore-${request_id}"

test "$(stat -Lc '%d:%U:%G:%a' "$stage")" = '64770:ubuntu:ubuntu:700'
test "$(stat -Lc '%U:%G:%a:%s' "$uploaded_zip")" = 'ubuntu:ubuntu:600:471181'
test "$(sha256sum "$uploaded_zip" | awk '{print $1}')" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
test "$(stat -Lc '%U:%G:%a:%s' "$uploaded_caddy")" = 'ubuntu:ubuntu:600:1749'
test "$(sha256sum "$uploaded_caddy" | awk '{print $1}')" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'
test "$(stat -Lc '%d:%i:%u:%g:%a:%s' "$live")" = '64770:1055513:0:0:644:1441'
test "$(sha256sum "$live" | awk '{print $1}')" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f'
for absent in "$target_dir" "$target" "$backup" "$next" "$restore" "$receipt"; do
  test ! -e "$absent" || {
    printf 'NO_OVERWRITE_PATH_EXISTS path=%s\n' "$absent" >&2
    exit 71
  }
done

/usr/bin/chown root:root "$uploaded_zip" "$uploaded_caddy"
/usr/bin/chmod 0644 "$uploaded_zip" "$uploaded_caddy"
/usr/bin/chown root:root "$stage"
/usr/bin/chmod 0700 "$stage"
/usr/bin/caddy validate --config "$uploaded_caddy" --adapter caddyfile

/usr/bin/mkdir -m 0755 -- "$target_dir"
test "$(stat -Lc '%d:%u:%g:%a' "$target_dir")" = '64770:0:0:755'
/usr/bin/ln -- "$uploaded_zip" "$target"
/usr/bin/unlink "$uploaded_zip"
test "$(stat -Lc '%d:%u:%g:%a:%h:%s' "$target")" = '64770:0:0:644:1:471181'
test "$(sha256sum "$target" | awk '{print $1}')" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'

/usr/bin/ln -- "$live" "$backup"
test "$(sha256sum "$backup" | awk '{print $1}')" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f'
/usr/bin/ln -- "$uploaded_caddy" "$next"
/usr/bin/mv -T -- "$next" "$live"
/usr/bin/unlink "$uploaded_caddy"

cleanup_exact_target() {
  test "$(stat -Lc '%d:%u:%g:%a:%h:%s' "$target")" = '64770:0:0:644:1:471181'
  test "$(sha256sum "$target" | awk '{print $1}')" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
  test "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = '1'
  /usr/bin/unlink "$target"
  /usr/bin/rmdir "$target_dir"
}

if ! /usr/bin/caddy validate --config "$entry" --adapter caddyfile; then
  /usr/bin/ln -- "$backup" "$restore"
  /usr/bin/mv -T -- "$restore" "$live"
  /usr/bin/caddy validate --config "$entry" --adapter caddyfile
  cleanup_exact_target
  printf 'CANDIDATE_VALIDATION_FAILED_PRIOR_CONFIG_AND_TARGET_RESTORED\n' >&2
  exit 72
fi

test "$(stat -Lc '%d:%u:%g:%a:%h:%s' "$live")" = '64770:0:0:644:1:1749'
test "$(sha256sum "$live" | awk '{print $1}')" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'

{
  stat -Lc 'TARGET %d %i %u %g %a %h %s' "$target"
  stat -Lc 'TARGET_DIR %d %i %u %g %a %h %s' "$target_dir"
  stat -Lc 'LIVE_CONFIG %d %i %u %g %a %h %s' "$live"
  stat -Lc 'BACKUP_CONFIG %d %i %u %g %a %h %s' "$backup"
} > "$receipt"
/usr/bin/chown root:root "$receipt"
/usr/bin/chmod 0400 "$receipt"

if ! /usr/bin/systemctl reload caddy; then
  test ! -e "$restore"
  /usr/bin/ln -- "$backup" "$restore"
  /usr/bin/mv -T -- "$restore" "$live"
  /usr/bin/caddy validate --config "$entry" --adapter caddyfile
  /usr/bin/systemctl reload caddy
  cleanup_exact_target
  printf 'CANDIDATE_RELOAD_FAILED_PRIOR_CONFIG_AND_TARGET_RESTORED\n' >&2
  exit 73
fi
/usr/bin/systemctl is-active --quiet caddy
printf 'PUBLISHED_PENDING_PUBLIC_GATE request=%s lease=%s receipt=%s\n' "$request_id" "$YNX_CENTRAL_SINGLE_USE_LEASE_ID" "$receipt"
cat "$receipt"
