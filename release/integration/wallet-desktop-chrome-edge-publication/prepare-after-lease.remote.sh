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
target_dir="$wallet/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d"
target="$target_dir/ynx-wallet-chrome-edge-0.1.0.zip"
backup="${live}.rollback-${request_id}"
next="${live}.next-${request_id}"
restore="${live}.restore-${request_id}"
sentinel="$wallet/sha256-69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044/ynx-wallet-macos-0.1.2-universal.dmg"

assert_stat() {
  local path="$1" expected="$2" actual
  actual="$(stat -Lc '%d:%i:%u:%g:%a:%s' "$path")"
  test "$actual" = "$expected" || {
    printf 'FOREIGN_IDENTITY path=%s expected=%s actual=%s\n' "$path" "$expected" "$actual" >&2
    exit 70
  }
}

assert_stat / '64770:2:0:0:755:4096'
assert_stat /opt '64770:131076:0:0:755:4096'
assert_stat /opt/ynx '64770:1312502:0:0:755:4096'
assert_stat "$downloads" '64770:2528711:0:0:755:4096'
assert_stat "$wallet" '64770:2528712:0:0:755:4096'
assert_stat /etc/caddy '64770:1051238:0:0:755:4096'
assert_stat /etc/caddy/conf.d '64770:1051258:0:0:755:4096'
assert_stat "$entry" '64770:1051746:0:0:644:928'
assert_stat "$live" '64770:1055513:0:0:644:1441'
test "$(sha256sum "$entry" | awk '{print $1}')" = '077fe80ea9aab24a32d64ba1fab3584e8aab10304e200e58d976d2c33edfb39f'
test "$(sha256sum "$live" | awk '{print $1}')" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f'
assert_stat "$sentinel" '64770:2528715:0:0:644:237777236'
test "$(stat -Lc '%h' "$sentinel")" = '1'
test "$(sha256sum "$sentinel" | awk '{print $1}')" = '69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044'

for absent in "$stage" "$target_dir" "$target" "$backup" "$next" "$restore"; do
  test ! -e "$absent" || {
    printf 'NO_OVERWRITE_PATH_EXISTS path=%s\n' "$absent" >&2
    exit 71
  }
done

/usr/bin/caddy validate --config "$entry" --adapter caddyfile
/usr/bin/mkdir -m 0700 -- "$stage"
/usr/bin/chown ubuntu:ubuntu "$stage"
test "$(stat -Lc '%d:%U:%G:%a' "$stage")" = '64770:ubuntu:ubuntu:700'
printf 'STAGING_READY request=%s lease=%s path=%s\n' "$request_id" "$YNX_CENTRAL_SINGLE_USE_LEASE_ID" "$stage"
