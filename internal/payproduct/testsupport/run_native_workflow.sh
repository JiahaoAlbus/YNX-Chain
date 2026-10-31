#!/bin/sh
# Runs only in a prepared read-only-source composition, never an owner checkout.
set -eu
composition=${1:?isolated composition path required}
fixture_dir=${2:?explicit temporary-chain public fixture output required}
case "$composition" in */owners/P06/pq-core-composition-*) ;; *) echo 'isolated P06 composition required' >&2; exit 2;; esac
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
codec_hash=$(shasum -a 256 "$composition/internal/ynxauth/invoice_action.go" | awk '{print $1}')
[ "$codec_hash" = bcd011e971ee69d844c989c70ca20fedad804f7bdf28595e35bb982f73af23f8 ] || { echo 'CORE codec pin differs' >&2; exit 2; }
fixture_hash=$(shasum -a 256 "$composition/internal/ynxauth/testdata/invoice-action-v1.json" | awk '{print $1}')
[ "$fixture_hash" = d5895426311ef8f4eea003d1ec548834d92ea9100052a5eed2d3d0616dbbff9a ] || { echo 'CORE fixture pin differs' >&2; exit 2; }
cp "$source_dir"/*.go "$composition/internal/payproduct/"
cp "$source_dir/../paygateway"/*.go "$composition/internal/paygateway/"
cd "$composition"
export PAY_CORE_WORKFLOW_DIR="$fixture_dir"
native_tags="pay_pq pay_securelink securelink_openssl ${YNX_PAY_NATIVE_OPTIONAL_TAGS:-}"
export YNX_PAY_TEST_DAEMON_BUILD_TAGS="$native_tags"
export GOMAXPROCS=${GOMAXPROCS:-2}
client_root="$source_dir/../../apps/pay/native"
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = merchant-fence ]; then
 go test -race -p 1 -tags pay_pq ./internal/payproduct -run '^TestNativeMerchantFence|^TestNativeInvoiceIntentBindingChecksOriginalMemberAtFinalStoreCommit$' -count=1 -timeout=4m -v
 exit
fi
node --test "$client_root/merchant-invoice-approval.test.mjs" "$client_root/pay-business-client.test.mjs" "$client_root/notification-inbox.test.mjs" "$client_root/main-entry.test.mjs"
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = main-entry ]; then
 export PAY_CLIENT_QA_MANIFEST="$fixture_dir/manifest.json"
 node "$client_root/testsupport/main-normal-review.mjs"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = notifications ]; then
 go test -p 1 -tags pay_pq ./internal/payproduct -run '^TestNativeInvoiceEvents' -count=1 -timeout=4m -v
 exit
fi
[ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = full ] || { echo 'unknown native workflow suite' >&2; exit 2; }
/usr/bin/python3 "$source_dir/testsupport/generate_core_workflow.py" "$composition"
if [ -n "${PAY_CLIENT_MAIN_SOURCE:-}" ]; then
 export PAY_CLIENT_WORKFLOW_DIR="$fixture_dir"
 export PAY_CLIENT_WORKFLOW_DRIVER="$client_root/testsupport/business-workflow.mjs"
fi
go test -p 1 ./internal/consensus -run '^TestExportPayConsumerWorkflow$' -count=1 -timeout=3m
if [ -n "${PAY_CLIENT_MAIN_SOURCE:-}" ]; then
 export PAY_CLIENT_QA_MANIFEST="$fixture_dir/manifest.json"
 node "$client_root/testsupport/main-normal-review.mjs"
fi
go test -p 1 -tags "$native_tags" ./internal/payproduct/... ./internal/paygateway/... -count=1 -timeout=5m
