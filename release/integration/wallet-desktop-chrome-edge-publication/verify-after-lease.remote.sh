#!/usr/bin/env bash
set -euo pipefail

request_id='P0-WALLET-CHROME-ZIP-PUBLICATION-20260823-01'
: "${YNX_CENTRAL_SINGLE_USE_LEASE_ID:?Central lease ID is required}"
test "${YNX_DOWNLOADS_PUBLICATION_EXECUTION_ACK:-}" = "${request_id}:VERIFY"

live='/etc/caddy/conf.d/downloads.ynxweb4.com.caddy'
target='/opt/ynx/public-downloads/wallet/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d/ynx-wallet-chrome-edge-0.1.0.zip'
sentinel='/opt/ynx/public-downloads/wallet/sha256-69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044/ynx-wallet-macos-0.1.2-universal.dmg'

test "$(stat -Lc '%d:%u:%g:%a:%h:%s' "$target")" = '64770:0:0:644:1:471181'
test "$(sha256sum "$target" | awk '{print $1}')" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
test "$(stat -Lc '%d:%u:%g:%a:%h:%s' "$live")" = '64770:0:0:644:1:1749'
test "$(sha256sum "$live" | awk '{print $1}')" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'
test "$(stat -Lc '%d:%i:%u:%g:%a:%h:%s' "$sentinel")" = '64770:2528715:0:0:644:1:237777236'
test "$(sha256sum "$sentinel" | awk '{print $1}')" = '69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044'
/usr/bin/systemctl is-active --quiet caddy
printf 'REMOTE_PUBLICATION_IDENTITIES_VERIFIED request=%s lease=%s\n' "$request_id" "$YNX_CENTRAL_SINGLE_USE_LEASE_ID"
