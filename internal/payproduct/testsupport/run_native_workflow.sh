#!/bin/sh
# Runs only in a prepared read-only-source composition, never an owner checkout.
set -eu
composition=${1:?isolated composition path required}
fixture_dir=${2:?explicit temporary-chain public fixture output required}
case "$composition" in */owners/P06/pq-core-composition-*) ;; *) echo 'isolated P06 composition required' >&2; exit 2;; esac
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = multi-refund-fixture ]; then
 : "${PAY_GO_BINARY:?exact original Go executable required}"
 /usr/bin/python3 "$source_dir/testsupport/generate_core_workflow.py" "$composition" --multi-refund
 cd "$composition"
 export PAY_CORE_WORKFLOW_DIR="$fixture_dir"
 "$PAY_GO_BINARY" test -p 1 ./internal/consensus -run '^TestExportPayMultiRefundWorkflow$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = r6-native-caller ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 : "${PAY_NATIVE_CALLER_INTAKE:?verified original Native component intake required}"
 : "${PAY_NATIVE_CALLER_RESULT:?external owned caller result required}"
 "$PAY_NODE_BINARY" "$source_dir/../../apps/pay/native/testsupport/r6-actual-native-caller.mjs" "$PAY_NATIVE_CALLER_INTAKE" "$PAY_NATIVE_CALLER_RESULT"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = r6-private-client ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 : "${PAY_ARCHIVE_CONTRACT_PROJECTOR:?compiled exact original Auth archive DATA path projector required}"
 "$PAY_NODE_BINARY" --test "$source_dir/../../apps/pay/native/r6/product-source-lifetime.test.mjs"
 "$PAY_NODE_BINARY" "$source_dir/../../apps/pay/native/testsupport/r6-archive-contract-path.mjs" "$PAY_ARCHIVE_CONTRACT_PROJECTOR"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = product-source ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 "$PAY_NODE_BINARY" --test "$source_dir/../../apps/pay/native/product-source.test.mjs"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = product-source-cloud ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 : "${PAY_CLOUD_SOURCE_ROOT:?complete verified frozen Cloud source closure required}"
 "$PAY_NODE_BINARY" --test "$source_dir/../../apps/pay/native/testsupport/product-source-cloud.mjs"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = product-source-cloud-service ]; then
 : "${PAY_GO_BINARY:?exact original Go executable required}"
 : "${PAY_CLOUD_SOURCE_ROOT:?prepared complete verified original Cloud closure required}"
 export PAY_PRODUCT_SOURCE_CLOUD_DRIVER="$source_dir/../../apps/pay/native/testsupport/product-source-cloud-service.mjs"
 cd "$PAY_CLOUD_SOURCE_ROOT"
 "$PAY_GO_BINARY" test -mod=readonly -race -p 1 ./internal/cloud -run '^TestP06ProductSourceActualCloudColdAndRevoke$' -count=1 -timeout=60s -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = product-source-shop-service ]; then
 : "${PAY_GO_BINARY:?exact original Go executable required}"
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 : "${PAY_SHOP_SOURCE_ROOT:?prepared complete verified original Shop closure required}"
 : "${SHOP_SOURCE_READ_SOCKET_ROOT:?short owned original Unix socket fixture root required}"
 export PAY_PRODUCT_SOURCE_SHOP_DRIVER="$source_dir/../../apps/pay/native/testsupport/product-source-shop-service.mjs"
 cd "$PAY_SHOP_SOURCE_ROOT"
 "$PAY_GO_BINARY" test -mod=readonly -race -p 1 -tags commerce_v2 ./internal/commerce -run '^TestP06ProductSourceActualShopUnixColdAndRevoke$' -count=1 -timeout=60s -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = native-producer-link ]; then
 : "${PAY_NATIVE_AUTH_BOUNDARY:?frozen original Auth Native boundary required}"
 : "${PAY_NATIVE_LINK_BOUNDARY:?frozen original LINK component required}"
 : "${PAY_NATIVE_PRODUCER_BOUNDARY:?frozen original P06 producer required}"
 : "${PAY_NATIVE_PRODUCER_OUTPUT:?new external producer evidence directory required}"
 : "${PAY_NATIVE_AUTH_SHA256:?original Auth manifest SHA256 required}"
 : "${PAY_NATIVE_LINK_SHA256:?original LINK manifest SHA256 required}"
 : "${PAY_NATIVE_PRODUCER_SHA256:?original P06 manifest SHA256 required}"
 /usr/bin/python3 "$source_dir/../../apps/pay/native/testsupport/run-native-producer-link.py" "$PAY_NATIVE_AUTH_BOUNDARY" "$PAY_NATIVE_LINK_BOUNDARY" "$PAY_NATIVE_PRODUCER_BOUNDARY" "$PAY_NATIVE_PRODUCER_OUTPUT" --auth-sha256 "$PAY_NATIVE_AUTH_SHA256" --link-sha256 "$PAY_NATIVE_LINK_SHA256" --producer-sha256 "$PAY_NATIVE_PRODUCER_SHA256"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = native-producer ]; then
 : "${PAY_NATIVE_AUTH_BOUNDARY:?frozen original Auth Native boundary required}"
 : "${PAY_NATIVE_PRODUCER_OUTPUT:?new external producer evidence directory required}"
 /usr/bin/python3 "$source_dir/../../apps/pay/native/testsupport/run-native-producer.py" "$PAY_NATIVE_AUTH_BOUNDARY" "$PAY_NATIVE_PRODUCER_OUTPUT"
 exit
fi
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
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = webhook-shop-original ]; then
 : "${PAY_SHOP_NOTIFICATION_DRIVER_BINARY:?frozen original Shop driver required}"
 : "${PAY_SHOP_NOTIFICATION_DRIVER_SHA256:?exact driver SHA256 required}"
 : "${PAY_SHOP_NOTIFICATION_INPUT:?exact retained original Shop input required}"
 : "${PAY_SHOP_NOTIFICATION_RESULT_DIR:?owned PUBLIC evidence directory required}"
 go test -p 1 -tags 'pay_pq pay_webhook_shop_joint pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativeWebhookActualShopTLSColdInboxRefusesReplacementArchive$' -count=1 -timeout=3m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = webhook-attempts ]; then
 export PAY_MULTI_REFUND_WORKFLOW_DIR="$fixture_dir"
 go test -race -p 1 -tags 'pay_pq pay_webhook_original pay_securelink securelink_openssl' ./internal/payproduct -run '^TestWebhook(DelayedRetryFreshSignatureSameOriginalAfterCold|AttemptProofRotationAndLostAckRemainOriginal|SigningRotationBeforeReservationSendsNothing|NativeReferenceDeadLetterReplayKeepsOriginal|ReplayCannotSpliceNativeReference|DeadLetterAndAuditedManualReplay|RetryBudgetSurvivesColdStoreAndDirectCalls|PersistsAttemptBeforeSending|ManualReplayKeepsOriginalSignedEvent|OutboxAtomicAndRotationRetainsEvent)$|^TestNativeWebhookReferenceUsesRetainedCoreOriginalsOnly$' -count=1 -timeout=2m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = main-result-client ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 : "${PAY_MAIN_PRODUCT_MODULE:?frozen original Main product wrapper required}"
 : "${PAY_MAIN_PRODUCT_SHA256:?exact original Main wrapper SHA256 required}"
 export PAY_MAIN_RESULT_DRIVER="$client_root/testsupport/main-result-consumer.mjs"
 "$PAY_NODE_BINARY" --test "$client_root/r6/main-result.test.mjs"
 go test -race -p 1 -tags 'pay_pq pay_main_result_client pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativeMainResultLostCreateColdOriginalLookupNoRetry$' -count=1 -timeout=1m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = multi-refund ]; then
 export PAY_MULTI_REFUND_WORKFLOW_DIR="$fixture_dir"
 go test -race -p 1 -tags 'pay_pq pay_multi_refund pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativePaySameBlockPartialRefundsThenFullColdReceipt$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = archive-unix-host ]; then
 : "${PAY_ARCHIVE_UNIX_SOCKET_ROOT:?owned short external Unix socket root required}"
 cp -R "$source_dir/nativehost" "$composition/internal/payproduct/"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl' ./internal/payproduct/nativehost -run '^TestPrivateNormalArchiveRegistrationKeepsMissingEngineClosed$' -count=1 -timeout=1m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = archive-unix ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 : "${PAY_ARCHIVE_UNIX_SOCKET_ROOT:?owned short external Unix socket root required}"
 export PAY_R6_ARCHIVE_CLIENT_DRIVER="$client_root/testsupport/r6-archive-recovery.mjs"
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativePayR6ActualArchiveClientNormalHTTPColdAndMerchantReceipt$|^TestNativeArchiveFiniteCanonicalWirePaths$|^TestNativeArchiveHandlerRejectsAliasesBeforeSourceCapture$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = shop-multi-refund ]; then
 : "${PAY_SHOP_REFUND_DRIVER_BINARY:?exact original Shop driver required}"
 : "${PAY_SHOP_REFUND_DRIVER_SHA256:?exact original Shop driver hash required}"
 export PAY_MULTI_REFUND_WORKFLOW_DIR="$fixture_dir"
 # Exercise the normal target under the unchanged original Shop 20s deadline.
 # The separate multi-refund suite retains race coverage for proof/cold state.
 # Full instrumented two-process run exceeded20s; its first cause is retained.
 go test -p 1 -tags 'pay_pq pay_multi_refund pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativePayActualShopSameBlockCumulativeRefundCold$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = shop-refund-journey ]; then
 : "${PAY_SHOP_REFUND_DRIVER_BINARY:?exact original Shop test driver binary required}"
 : "${PAY_SHOP_REFUND_DRIVER_SHA256:?immutable original Shop driver hash required}"
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativePayActualShopReceiptReturnPartialRefundCold$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = refund-receipt ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 "$PAY_NODE_BINARY" --test "$client_root/r6/archive-details.test.mjs"
 export PAY_R6_ARCHIVE_CLIENT_DRIVER="$client_root/testsupport/r6-archive-recovery.mjs"
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativeArchiveSameBlockRefundsUseExecutionCoordinates$|^TestNativeArchiveRejectsAmbiguousCoordinatesOrRefundIdentity$|^TestNativePayR6ActualArchiveClientNormalHTTPColdAndMerchantReceipt$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = r6-archive ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 "$PAY_NODE_BINARY" --test "$client_root/r6/archived-recovery.test.mjs"
 export PAY_R6_ARCHIVE_CLIENT_DRIVER="$client_root/testsupport/r6-archive-recovery.mjs"
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativePayR6ActualArchiveClientNormalHTTPColdAndMerchantReceipt$' -count=1 -timeout=5m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = native-archive ]; then
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativePayVerifiedOriginalArchiveColdHTTPAndAtomicRecovery$|^TestNativePayOriginalArchiveLegacyMissingNeverBackfills$' -count=1 -timeout=3m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = retained-terms ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 "$PAY_NODE_BINARY" --test --test-name-pattern='original terms archive' "$client_root/merchant-invoice-approval.test.mjs"
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNativeInvoiceReadRetainsOriginalTermsDataOnly$' -count=1 -timeout=45s -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = main-pay-source-refusal ]; then
 : "${PAY_CLIENT_MAIN_SOURCE:?fixed P01 Pay-entry source required}"
 : "${PAY_MAIN_READONLY_DEPENDENCIES:?original owner read-only dependency root required}"
 : "${PAY_MAIN_SDK_PREFIX:?complete verified original SDK prefix required}"
 export PAY_CLIENT_QA_MANIFEST="$fixture_dir/manifest.json"
 node "$client_root/testsupport/main-pay-source-refusal.mjs"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = main-pay-refusal ]; then
 : "${PAY_CLIENT_MAIN_SOURCE:?fixed original Core-only P01 Main source required}"
 node "$client_root/testsupport/main-pay-missing-entry.mjs"
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = intent-client ]; then
 : "${PAY_NODE_BINARY:?exact original Node executable required}"
 export PAY_PRODUCT_INTENT_CLIENT_DRIVER="$client_root/testsupport/product-intent-consumer.mjs"
 "$PAY_NODE_BINARY" --test "$client_root/invoice-product-intent.test.mjs" "$client_root/main-entry.test.mjs" "$client_root/pay-business-client.test.mjs"
 go test -race -p 1 -tags 'pay_pq pay_product_intent_client' ./internal/payproduct -run '^TestNativeIntentClientLostCreateColdOriginalLookupAndRefusal$' -count=1 -timeout=1m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = engine-node ]; then
 : "${PAY_ENGINE_FIXTURE_REPORT:?new external fixture report path required}"
 : "${PAY_ENGINE_SOCKET_ROOT:?owned external short socket root required}"
 cp -R "$source_dir/nativehost" "$composition/internal/payproduct/"
 node "$source_dir/testsupport/prepare_engine_node_fixture.mjs" "$composition" "$source_dir/../.." "$PAY_ENGINE_FIXTURE_REPORT"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl pay_engine_host_fixture' ./internal/consensus ./internal/payproduct/nativehost -run '^TestPayCoreAttachmentRetainsBorrowedEngineUntilDrained$|^TestCoreAttachmentFailedConstructionRetainsCleanupAndCause$' -count=1 -timeout=2m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = engine ]; then
 cp -R "$source_dir/nativehost" "$composition/internal/payproduct/"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl' ./internal/payproduct/nativehost -run '^TestEngine|^TestNormalNativeInvoice|^TestNormalHostUsesSameOriginalStore|^TestOriginalInvoiceRPC|^TestBFTRPC' -count=1 -timeout=2m -v
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl' ./internal/payproduct -run '^TestPrivateCoreRoutes' -count=1 -timeout=2m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = private-process ]; then
 : "${PAY_PRIVATE_HOST_BINARY:?exact already compiled private host required}"
 : "${PAY_PRIVATE_HOST_SHA256:?exact private host hash required}"
 : "${PAY_PRIVATE_SOCKET_ROOT:?owned external short socket root required}"
 cp -R "$source_dir/nativehost" "$composition/internal/payproduct/"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl pay_product_private' ./internal/payproduct/nativehost -run '^TestPrivateNormalProcessColdRecoveryAndSIGTERM$' -count=1 -timeout=1m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = product-parents ]; then
 cp -R "$source_dir/nativehost" "$composition/internal/payproduct/"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl' ./internal/payproduct/nativehost -run '^TestProducts' -count=1 -timeout=2m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = normal-daemon ]; then
 : "${PAY_NORMAL_PARENT_DAEMON_BINARY:?exact already compiled normal daemon required}"
 : "${PAY_NORMAL_PARENT_DAEMON_SHA256:?exact normal daemon hash required}"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl pay_normal_daemon' ./internal/payproduct -run '^TestNormalHostedDaemonStartupAndShutdown$' -count=1 -timeout=1m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = normal-parent ]; then
 go test -race -p 1 -tags 'pay_pq pay_securelink securelink_openssl' ./internal/payproduct -run '^TestNormalProduct' -count=1 -timeout=2m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = native-drain ]; then
 cp "$source_dir/cmd/ynx-pay-productd"/*.go "$composition/internal/payproduct/cmd/ynx-pay-productd/"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl' ./internal/payproduct/cmd/ynx-pay-productd -run '^TestNativeSourceSurvivesActualHTTPDrainTimeout$' -count=1 -timeout=1m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = auth-normal-host ]; then
 cp -R "$source_dir/nativehost" "$composition/internal/payproduct/"
 cp "$source_dir/cmd/ynx-pay-productd"/*.go "$composition/internal/payproduct/cmd/ynx-pay-productd/"
 go test -race -p 1 -tags 'pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl' ./internal/payproduct/nativehost -run '^TestNormal' -count=1 -timeout=4m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = merchant-fence-link ]; then
 go test -race -p 1 -tags 'pay_pq pay_localcaller_current' ./internal/payproduct -run '^TestNativeMerchantFenceOriginalLocalCallerAndStoreCommit$' -count=1 -timeout=4m -v
 exit
fi
if [ "${PAY_NATIVE_WORKFLOW_SUITE:-full}" = merchant-fence ]; then
 go test -race -p 1 -tags pay_pq ./internal/payproduct -run '^TestNativeMerchantFence|^TestNativeInvoiceIntentBindingChecksOriginalMemberAtFinalStoreCommit$' -count=1 -timeout=4m -v
 exit
fi
node --test "$client_root/product-source.test.mjs" "$client_root/merchant-invoice-approval.test.mjs" "$client_root/pay-business-client.test.mjs" "$client_root/notification-inbox.test.mjs" "$client_root/main-entry.test.mjs"
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
