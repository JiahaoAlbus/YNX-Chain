#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/bin"
  cat > "$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${*: -1}"
case "$url" in
  http://127.0.0.1:6420/health)
    printf '%s\n' '{"ok":true}'
    ;;
  http://127.0.0.1:6420/status)
    printf '%s\n' '{"chainId":"6423","nativeCurrencySymbol":"YNXT","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6420/node/identity)
    printf '%s\n' '{"role":"primary","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6426/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6427/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6428/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6429/health)
    printf '%s\n' '{"ok":true,"chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"providerConfigured":true,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6430/health)
    printf '%s\n' '{"ok":true,"service":"ynx-payd","chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"merchantConfigured":true,"signingConfigured":true,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6431/health)
    printf '%s\n' '{"ok":true,"service":"ynx-trustd","chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"bodyLimitBytes":1048576,"exportLimitBytes":2097152,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6432/health)
    printf '%s\n' '{"ok":true,"service":"ynx-resourced","chainId":"6423","nativeSymbol":"YNXT","upstreamOk":true,"bodyLimitBytes":1048576,"responseLimitBytes":2097152,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6433/health)
    printf '%s\n' '{"ok":true,"degraded":true,"service":"ynx-bridged","schemaVersion":7,"stateMachineVersion":"ynx.bridge.lifecycle.v1","nativeSymbol":"YNXT","persistence":"atomic-json-file","stateIntegrity":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerStatus":"unavailable-no-verified-provider-connection","contractStatus":"unavailable-no-verified-contract-deployment","externalSubmissionEnabled":false,"liveBridge":false,"truthfulStatus":"degraded-local-coordinator-only-no-provider-or-contract","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6433/version)
    printf '%s\n' '{"service":"ynx-bridged","source":"ynx-bridge-runtime","schemaVersion":7,"stateMachineVersion":"ynx.bridge.lifecycle.v1","degraded":true,"providerStatus":"unavailable-no-verified-provider-connection","availableProviderCount":0,"contractStatus":"unavailable-no-verified-contract-deployment","liveBridge":false,"externalSubmissionEnabled":false,"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6433/bridge/status)
    if [[ "${YNX_CHECK_LOCAL_SERVICES_SELF_TEST_PROVIDER_CONNECTED:-0}" == "1" ]]; then
      printf '%s\n' '{"schemaVersion":1,"source":"ynx-bridge-status","coordinatorState":"available-local-coordinator","externalBridgeState":"provider-api-connected-route-execution-unavailable","failureStatus":"source-intent-builder-testnet-execution-and-public-deployment-unavailable","routeCount":2,"providerCount":2,"availableProviderCount":1,"assetCount":4,"providerConnection":"connected-live-provider-api-route-execution-disabled","externalSubmissionEnabled":false,"userAssetMovementEnabled":false,"officialStablecoinRouteAvailable":false,"deployedPublic":false,"capabilities":{"readOnlyEvidence":true,"quoteGeneration":true,"quoteExecution":false,"walletReviewGeneration":true,"sourceSubmission":false,"destinationMintRelease":false,"refundExecution":false,"disputeRecording":true,"emergencyExitExecution":false},"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    else
      printf '%s\n' '{"schemaVersion":1,"source":"ynx-bridge-status","coordinatorState":"available-local-coordinator","externalBridgeState":"unavailable","failureStatus":"no-verified-provider-contract-or-public-deployment","routeCount":1,"providerCount":1,"availableProviderCount":0,"assetCount":2,"providerConnection":"not-connected","externalSubmissionEnabled":false,"userAssetMovementEnabled":false,"officialStablecoinRouteAvailable":false,"deployedPublic":false,"capabilities":{"readOnlyEvidence":true,"quoteGeneration":true,"quoteExecution":false,"walletReviewGeneration":true,"sourceSubmission":false,"destinationMintRelease":false,"refundExecution":false,"disputeRecording":true,"emergencyExitExecution":false},"build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    fi
    ;;
  http://127.0.0.1:6433/bridge/routes)
    if [[ "${YNX_CHECK_LOCAL_SERVICES_SELF_TEST_UNSAFE_ROUTE:-0}" == "1" ]]; then
      printf '%s\n' '{"schemaVersion":1,"source":"ynx-bridge-route-registry","routes":[{"id":"route-1","availability":"available","failureStatus":"","executable":true,"externalSubmissionEnabled":true}]}'
    else
      printf '%s\n' '{"schemaVersion":1,"source":"ynx-bridge-route-registry","routes":[{"id":"route-1","availability":"unavailable","failureStatus":"provider-route-not-configured","executable":false,"externalSubmissionEnabled":false}]}'
    fi
    ;;
  http://127.0.0.1:6433/bridge/providers)
    printf '%s\n' '{"schemaVersion":1,"source":"ynx-bridge-provider-registry","providers":[{"id":"provider-1","routeAvailable":false,"executable":false,"failureStatus":"provider-route-not-configured"}]}'
    ;;
  http://127.0.0.1:6433/bridge/assets)
    printf '%s\n' '{"schemaVersion":1,"source":"ynx-bridge-asset-registry","assets":[{"id":"asset-1","availability":"unavailable","externalExecutionEnabled":false},{"id":"asset-2","availability":"unavailable","externalExecutionEnabled":false}]}'
    ;;
  http://127.0.0.1:6434/health)
    printf '%s\n' '{"ok":true,"service":"ynx-stablecoind","nativeSymbol":"YNXT","persistence":"atomic-json-file","issuerSupportEstablished":false,"externalExecutionEnabled":false,"nativeYnxtIssuerActionsAllowed":false,"truthfulStatus":"local-control-plane-only-no-issuer-support-no-execution","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6435/health)
    printf '%s\n' '{"ok":true,"service":"ynx-chatd","persistence":"atomic-json-mode-0600","nativeAddressDefault":true,"plaintextStored":false,"remoteDeployed":true,"truthfulStatus":"remote-bounded-chat-core-no-public-ingress-claim","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6436/health)
    printf '%s\n' '{"ok":true,"service":"ynx-squared","persistence":"atomic-json-mode-0600","nativeIdentity":"ynx1","remoteDeployed":true,"truthfulStatus":"remote-bounded-square-core-no-public-ingress-claim","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  http://127.0.0.1:6437/health)
    printf '%s\n' '{"ok":true,"service":"ynx-app-gatewayd","browserBoundary":"exact-https-origin","nativeBoundary":"ynx-mobile-v1","ownershipProof":"ynx1-secp256k1-plus-ed25519-device","sessionStorage":"integrity-checked-atomic-mode-0600-token-hashes-only","remoteDeployed":true,"truthfulStatus":"remote-first-party-app-gateway","build":{"commit":"abc123def456","release":"ynx-chain-abc123def456","buildTime":"2026-07-10T00:00:00Z"}}'
    ;;
  *)
    echo "unexpected URL: $url" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "$tmp/bin/curl"
  YNX_EXPECT_BRIDGE_SERVICE=1 YNX_EXPECT_STABLECOIN_SERVICE=1 YNX_EXPECT_CHAT_SERVICE=1 YNX_EXPECT_SQUARE_SERVICE=1 YNX_EXPECT_APP_GATEWAY_SERVICE=1 PATH="$tmp/bin:$PATH" "$0" primary abc123def456 ynx-chain-abc123def456 6423 full
  PATH="$tmp/bin:$PATH" "$0" primary abc123def456 ynx-chain-abc123def456 6423 bridge
  YNX_CHECK_LOCAL_SERVICES_SELF_TEST_PROVIDER_CONNECTED=1 PATH="$tmp/bin:$PATH" "$0" primary abc123def456 ynx-chain-abc123def456 6423 bridge
  if YNX_CHECK_LOCAL_SERVICES_SELF_TEST_UNSAFE_ROUTE=1 PATH="$tmp/bin:$PATH" "$0" primary abc123def456 ynx-chain-abc123def456 6423 bridge >"$tmp/unsafe-route.log" 2>&1; then
    echo "check-local-services self-test accepted an executable Bridge route" >&2
    exit 1
  fi
  grep -Fq 'unexpectedly contains "executable":true' "$tmp/unsafe-route.log"
  PATH="$tmp/bin:$PATH" "$0" singapore abc123def456 ynx-chain-abc123def456 6423 validator
  echo "check-local-services self-test passed"
  exit 0
fi

role="${1:?missing role}"
expected_commit="${2:?missing expected commit}"
expected_release="${3:?missing expected release}"
expected_chain_id="${4:?missing expected numeric chain id}"
mode="${5:-validator}"
attempts="${YNX_LOCAL_SERVICE_CHECK_ATTEMPTS:-30}"
sleep_seconds="${YNX_LOCAL_SERVICE_CHECK_SLEEP_SECONDS:-2}"

fetch_with_retry() {
  local name="$1" url="$2" body="" attempt
  for attempt in $(seq 1 "$attempts"); do
    if body="$(curl -fsS "$url" 2>/dev/null)"; then
      printf '%s' "$body"
      return 0
    fi
    sleep "$sleep_seconds"
  done
  echo "local service check failed: $name did not respond at $url after $attempts attempts" >&2
  return 1
}

require_contains() {
  local name="$1" body="$2" needle="$3"
  if [[ "$body" != *"$needle"* ]]; then
    echo "local service check failed: $name missing $needle" >&2
    echo "$body" >&2
    return 1
  fi
}

require_absent() {
  local name="$1" body="$2" needle="$3"
  if [[ "$body" == *"$needle"* ]]; then
    echo "local service check failed: $name unexpectedly contains $needle" >&2
    echo "$body" >&2
    return 1
  fi
}

require_one_of() {
  local name="$1" body="$2"
  shift 2
  local needle
  for needle in "$@"; do
    if [[ "$body" == *"$needle"* ]]; then
      return 0
    fi
  done
  echo "local service check failed: $name missing every accepted value: $*" >&2
  echo "$body" >&2
  return 1
}

check_chain_surface() {
  local status identity
  fetch_with_retry "chain health" "http://127.0.0.1:6420/health" >/dev/null
  status="$(fetch_with_retry "chain status" "http://127.0.0.1:6420/status")"
  require_contains "chain status" "$status" "$expected_chain_id"
  require_contains "chain status" "$status" "YNXT"
  require_contains "chain status build commit" "$status" "$expected_commit"
  require_contains "chain status release" "$status" "$expected_release"

  identity="$(fetch_with_retry "node identity" "http://127.0.0.1:6420/node/identity")"
  require_contains "node identity build commit" "$identity" "$expected_commit"
  require_contains "node identity release" "$identity" "$expected_release"
}

check_bridge_surface() {
  local bridge_gateway bridge_version bridge_status bridge_routes bridge_providers bridge_assets
  bridge_gateway="$(fetch_with_retry "Bridge coordinator health" "http://127.0.0.1:6433/health")"
  require_contains "Bridge coordinator health" "$bridge_gateway" '"ok":true'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"degraded":true'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"service":"ynx-bridged"'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"schemaVersion":7'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"stateMachineVersion":"ynx.bridge.lifecycle.v1"'
  require_contains "Bridge coordinator health" "$bridge_gateway" "YNXT"
  require_contains "Bridge coordinator health" "$bridge_gateway" '"persistence":"atomic-json-file"'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"stateIntegrity":"'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"contractStatus":"unavailable-no-verified-contract-deployment"'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"externalSubmissionEnabled":false'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"liveBridge":false'
  require_contains "Bridge coordinator health" "$bridge_gateway" '"truthfulStatus":"degraded-'
  require_contains "Bridge coordinator health build commit" "$bridge_gateway" "$expected_commit"
  require_contains "Bridge coordinator health release" "$bridge_gateway" "$expected_release"

  bridge_version="$(fetch_with_retry "Bridge coordinator version" "http://127.0.0.1:6433/version")"
  require_contains "Bridge coordinator version" "$bridge_version" '"service":"ynx-bridged"'
  require_contains "Bridge coordinator version" "$bridge_version" '"source":"ynx-bridge-runtime"'
  require_contains "Bridge coordinator version" "$bridge_version" '"schemaVersion":7'
  require_contains "Bridge coordinator version" "$bridge_version" '"stateMachineVersion":"ynx.bridge.lifecycle.v1"'
  require_contains "Bridge coordinator version" "$bridge_version" '"externalSubmissionEnabled":false'
  require_contains "Bridge coordinator version" "$bridge_version" '"liveBridge":false'
  require_contains "Bridge coordinator version build commit" "$bridge_version" "$expected_commit"
  require_contains "Bridge coordinator version release" "$bridge_version" "$expected_release"

  bridge_status="$(fetch_with_retry "Bridge product status" "http://127.0.0.1:6433/bridge/status")"
  require_contains "Bridge product status" "$bridge_status" '"source":"ynx-bridge-status"'
  require_contains "Bridge product status" "$bridge_status" '"coordinatorState":"available-local-coordinator"'
  require_one_of "Bridge product status external state" "$bridge_status" \
    '"externalBridgeState":"unavailable"' \
    '"externalBridgeState":"provider-api-connected-route-execution-unavailable"'
  require_one_of "Bridge product status Provider connection" "$bridge_status" \
    '"providerConnection":"not-connected"' \
    '"providerConnection":"connected-live-provider-api-route-execution-disabled"'
  require_one_of "Bridge product status available Provider count" "$bridge_status" \
    '"availableProviderCount":0' \
    '"availableProviderCount":1'
  require_contains "Bridge product status" "$bridge_status" '"externalSubmissionEnabled":false'
  require_contains "Bridge product status" "$bridge_status" '"userAssetMovementEnabled":false'
  require_contains "Bridge product status" "$bridge_status" '"officialStablecoinRouteAvailable":false'
  require_contains "Bridge product status" "$bridge_status" '"deployedPublic":false'
  require_contains "Bridge product status" "$bridge_status" '"quoteExecution":false'
  require_contains "Bridge product status" "$bridge_status" '"sourceSubmission":false'
  require_contains "Bridge product status" "$bridge_status" '"destinationMintRelease":false'
  require_contains "Bridge product status build commit" "$bridge_status" "$expected_commit"
  require_contains "Bridge product status release" "$bridge_status" "$expected_release"

  bridge_routes="$(fetch_with_retry "Bridge routes" "http://127.0.0.1:6433/bridge/routes")"
  require_contains "Bridge routes" "$bridge_routes" '"source":"ynx-bridge-route-registry"'
  require_contains "Bridge routes" "$bridge_routes" '"routes":['
  require_absent "Bridge routes" "$bridge_routes" '"executable":true'
  require_absent "Bridge routes" "$bridge_routes" '"externalSubmissionEnabled":true'

  bridge_providers="$(fetch_with_retry "Bridge providers" "http://127.0.0.1:6433/bridge/providers")"
  require_contains "Bridge providers" "$bridge_providers" '"source":"ynx-bridge-provider-registry"'
  require_contains "Bridge providers" "$bridge_providers" '"providers":['
  require_absent "Bridge providers" "$bridge_providers" '"routeAvailable":true'
  require_absent "Bridge providers" "$bridge_providers" '"executable":true'

  bridge_assets="$(fetch_with_retry "Bridge assets" "http://127.0.0.1:6433/bridge/assets")"
  require_contains "Bridge assets" "$bridge_assets" '"source":"ynx-bridge-asset-registry"'
  require_contains "Bridge assets" "$bridge_assets" '"assets":['
  require_absent "Bridge assets" "$bridge_assets" '"externalExecutionEnabled":true'
}

check_full_stack_surface() {
  local indexer explorer faucet ai_gateway pay_gateway trust_gateway resource_gateway stablecoin_gateway chat_gateway square_gateway app_gateway
  indexer="$(fetch_with_retry "indexer health" "http://127.0.0.1:6426/health")"
  require_contains "indexer health" "$indexer" "$expected_chain_id"
  require_contains "indexer health" "$indexer" "YNXT"
  require_contains "indexer health build commit" "$indexer" "$expected_commit"
  require_contains "indexer health release" "$indexer" "$expected_release"

  explorer="$(fetch_with_retry "explorer health" "http://127.0.0.1:6427/health")"
  require_contains "explorer health" "$explorer" "$expected_chain_id"
  require_contains "explorer health" "$explorer" "YNXT"
  require_contains "explorer health build commit" "$explorer" "$expected_commit"
  require_contains "explorer health release" "$explorer" "$expected_release"

  faucet="$(fetch_with_retry "faucet health" "http://127.0.0.1:6428/health")"
  require_contains "faucet health" "$faucet" "$expected_chain_id"
  require_contains "faucet health" "$faucet" "YNXT"
  require_contains "faucet health build commit" "$faucet" "$expected_commit"
  require_contains "faucet health release" "$faucet" "$expected_release"

  ai_gateway="$(fetch_with_retry "AI Gateway health" "http://127.0.0.1:6429/health")"
  require_contains "AI Gateway health" "$ai_gateway" "$expected_chain_id"
  require_contains "AI Gateway health" "$ai_gateway" "YNXT"
  require_contains "AI Gateway health" "$ai_gateway" '"providerConfigured":true'
  require_contains "AI Gateway health build commit" "$ai_gateway" "$expected_commit"
  require_contains "AI Gateway health release" "$ai_gateway" "$expected_release"

  pay_gateway="$(fetch_with_retry "Pay Gateway health" "http://127.0.0.1:6430/health")"
  require_contains "Pay Gateway health" "$pay_gateway" "$expected_chain_id"
  require_contains "Pay Gateway health" "$pay_gateway" "YNXT"
  require_contains "Pay Gateway health" "$pay_gateway" '"merchantConfigured":true'
  require_contains "Pay Gateway health" "$pay_gateway" '"signingConfigured":true'
  require_contains "Pay Gateway health build commit" "$pay_gateway" "$expected_commit"
  require_contains "Pay Gateway health release" "$pay_gateway" "$expected_release"

  trust_gateway="$(fetch_with_retry "Trust Gateway health" "http://127.0.0.1:6431/health")"
  require_contains "Trust Gateway health" "$trust_gateway" "$expected_chain_id"
  require_contains "Trust Gateway health" "$trust_gateway" "YNXT"
  require_contains "Trust Gateway health" "$trust_gateway" '"bodyLimitBytes":1048576'
  require_contains "Trust Gateway health" "$trust_gateway" '"exportLimitBytes":2097152'
  require_contains "Trust Gateway health build commit" "$trust_gateway" "$expected_commit"
  require_contains "Trust Gateway health release" "$trust_gateway" "$expected_release"

  resource_gateway="$(fetch_with_retry "Resource Gateway health" "http://127.0.0.1:6432/health")"
  require_contains "Resource Gateway health" "$resource_gateway" "$expected_chain_id"
  require_contains "Resource Gateway health" "$resource_gateway" "YNXT"
  require_contains "Resource Gateway health" "$resource_gateway" '"bodyLimitBytes":1048576'
  require_contains "Resource Gateway health" "$resource_gateway" '"responseLimitBytes":2097152'
  require_contains "Resource Gateway health build commit" "$resource_gateway" "$expected_commit"
  require_contains "Resource Gateway health release" "$resource_gateway" "$expected_release"

  if [[ "${YNX_EXPECT_BRIDGE_SERVICE:-0}" == "1" ]]; then
    check_bridge_surface
  fi

  if [[ "${YNX_EXPECT_STABLECOIN_SERVICE:-0}" == "1" ]]; then
    stablecoin_gateway="$(fetch_with_retry "Stablecoin control health" "http://127.0.0.1:6434/health")"
    require_contains "Stablecoin control health" "$stablecoin_gateway" "YNXT"
    require_contains "Stablecoin control health" "$stablecoin_gateway" '"issuerSupportEstablished":false'
    require_contains "Stablecoin control health" "$stablecoin_gateway" '"externalExecutionEnabled":false'
    require_contains "Stablecoin control health" "$stablecoin_gateway" '"nativeYnxtIssuerActionsAllowed":false'
    require_contains "Stablecoin control health" "$stablecoin_gateway" '"truthfulStatus":"local-control-plane-only-no-issuer-support-no-execution"'
    require_contains "Stablecoin control health build commit" "$stablecoin_gateway" "$expected_commit"
    require_contains "Stablecoin control health release" "$stablecoin_gateway" "$expected_release"
  fi

  if [[ "${YNX_EXPECT_CHAT_SERVICE:-0}" == "1" ]]; then
    chat_gateway="$(fetch_with_retry "Chat health" "http://127.0.0.1:6435/health")"
    require_contains "Chat health" "$chat_gateway" '"nativeAddressDefault":true'
    require_contains "Chat health" "$chat_gateway" '"plaintextStored":false'
    require_contains "Chat health" "$chat_gateway" '"remoteDeployed":true'
    require_contains "Chat health" "$chat_gateway" '"persistence":"atomic-json-mode-0600"'
    require_contains "Chat health build commit" "$chat_gateway" "$expected_commit"
    require_contains "Chat health release" "$chat_gateway" "$expected_release"
  fi

  if [[ "${YNX_EXPECT_SQUARE_SERVICE:-0}" == "1" ]]; then
    square_gateway="$(fetch_with_retry "Square health" "http://127.0.0.1:6436/health")"
    require_contains "Square health" "$square_gateway" '"nativeIdentity":"ynx1"'
    require_contains "Square health" "$square_gateway" '"remoteDeployed":true'
    require_contains "Square health" "$square_gateway" '"persistence":"atomic-json-mode-0600"'
    require_contains "Square health build commit" "$square_gateway" "$expected_commit"
    require_contains "Square health release" "$square_gateway" "$expected_release"
  fi

  if [[ "${YNX_EXPECT_APP_GATEWAY_SERVICE:-0}" == "1" ]]; then
    app_gateway="$(fetch_with_retry "App Gateway health" "http://127.0.0.1:6437/health")"
    require_contains "App Gateway health" "$app_gateway" '"browserBoundary":"exact-https-origin"'
    require_contains "App Gateway health" "$app_gateway" '"nativeBoundary":"ynx-mobile-v1"'
    require_contains "App Gateway ownership proof" "$app_gateway" '"ownershipProof":"ynx1-secp256k1-plus-ed25519-device"'
    require_contains "App Gateway session storage" "$app_gateway" '"sessionStorage":"integrity-checked-atomic-mode-0600-token-hashes-only"'
    require_contains "App Gateway health" "$app_gateway" '"remoteDeployed":true'
    require_contains "App Gateway health" "$app_gateway" '"truthfulStatus":"remote-first-party-app-gateway"'
    require_contains "App Gateway health build commit" "$app_gateway" "$expected_commit"
    require_contains "App Gateway health release" "$app_gateway" "$expected_release"
  fi
}

case "$mode" in
  validator)
    check_chain_surface
    ;;
  bridge)
    check_bridge_surface
    ;;
  full)
    check_chain_surface
    check_full_stack_surface
    ;;
  *)
    echo "unknown local service check mode for $role: $mode" >&2
    exit 1
    ;;
esac

echo "local service check passed: $role $mode $expected_release"
