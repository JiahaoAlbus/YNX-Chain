#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?missing extracted release directory}"
expected_commit="${2:?missing expected commit}"
expected_release="${3:?missing expected release}"

[[ "$(id -u)" == "0" ]] || { echo "remote Bridge installer must run as root" >&2; exit 1; }
[[ "$expected_commit" =~ ^[0-9a-f]{12}$ ]] || { echo "expected commit must be a 12-character Git SHA" >&2; exit 1; }
[[ "$expected_release" == "ynx-bridge-$expected_commit" ]] || { echo "release name does not match expected commit" >&2; exit 1; }
[[ -d "$release_dir" && ! -L "$release_dir" ]] || { echo "release directory is missing or unsafe" >&2; exit 1; }
command -v openssl >/dev/null
command -v python3 >/dev/null
command -v sha256sum >/dev/null
command -v systemctl >/dev/null
id -u ynx >/dev/null

(
  cd "$release_dir"
  sha256sum -c SHA256SUMS
)

umask 077
secret_dir=/etc/ynx/bridge-secrets
relayer_dir=/etc/ynx/bridge-relayers
state_dir=/var/lib/ynx-chain/bridge
backup_dir="/var/backups/ynx-chain/bridge-predeploy-$expected_release"
mkdir -p "$secret_dir" "$relayer_dir" "$state_dir" "$backup_dir"
chown root:root "$secret_dir" "$relayer_dir"
chown ynx:ynx "$state_dir"
chmod 0700 "$secret_dir" "$relayer_dir" "$state_dir" "$backup_dir"

create_secret() {
  local path="$1"
  if [[ ! -s "$path" ]]; then
    openssl rand -hex 32 >"$path"
  fi
  chown root:root "$path"
  chmod 0600 "$path"
}

create_relayer_key() {
  local name="$1"
  local private_key="$relayer_dir/$name.pem"
  local public_key="$relayer_dir/$name.pub"
  if [[ ! -s "$private_key" ]]; then
    openssl genpkey -algorithm Ed25519 -out "$private_key"
  fi
  openssl pkey -in "$private_key" -pubout -outform DER | tail -c 32 | base64 | tr -d '\n' >"$public_key"
  printf '\n' >>"$public_key"
  chown root:root "$private_key" "$public_key"
  chmod 0600 "$private_key" "$public_key"
}

create_secret "$secret_dir/api-key"
create_secret "$secret_dir/gateway-key"
create_secret "$secret_dir/quote-seal-key"
create_relayer_key relayer-a
create_relayer_key relayer-b

api_key="$(<"$secret_dir/api-key")"
gateway_key="$(<"$secret_dir/gateway-key")"
quote_seal_key="$(<"$secret_dir/quote-seal-key")"
relayer_a="$(<"$relayer_dir/relayer-a.pub")"
relayer_b="$(<"$relayer_dir/relayer-b.pub")"
[[ ${#api_key} -eq 64 && ${#gateway_key} -eq 64 && ${#quote_seal_key} -eq 64 ]] || { echo "generated Bridge secrets have invalid length" >&2; exit 1; }

bridge_env_stage="/etc/ynx/.ynx-bridged.env.$expected_release"
app_env_stage="/etc/ynx/.ynx-app-gatewayd.env.$expected_release"
route_policies_json='[{"provider":"unapproved-testnet-candidate","classification":"external-bridge-adapter","sourceChain":"ynx_6423-1","destinationChain":"external-testnet-unavailable","sourceAsset":"YNXT","destinationAsset":"wrapped-YNXT","sourceAssetClass":"ynxt-bridge-candidate","destinationAssetClass":"wrapped-test-asset","minConfirmations":12,"maxAmount":"1000000000","maxOutstanding":"5000000000","dailyLimit":"10000000000","userOutstandingLimit":"2000000000","largeTransferThreshold":"500000000","largeTransferDelaySeconds":3600,"assetBoundary":"canonical-to-represented","externalSubmission":false},{"provider":"circle-cctp-v2","classification":"official-stablecoin-transfer-candidate","sourceChain":"ethereum-sepolia","destinationChain":"base-sepolia","sourceAsset":"sepolia-usdc","destinationAsset":"base-sepolia-usdc","sourceAssetClass":"testnet-stablecoin","destinationAssetClass":"testnet-stablecoin","minConfirmations":12,"maxAmount":"1000000000","maxOutstanding":"1000000000","dailyLimit":"10000000000","userOutstandingLimit":"1000000000","largeTransferThreshold":"500000000","largeTransferDelaySeconds":3600,"assetBoundary":"canonical-to-canonical","externalSubmission":false}]'
provider_routes_json='[{"provider":"circle-cctp-v2","adapter":"circle-cctp-v2","environment":"testnet","baseUrl":"https://iris-api-sandbox.circle.com","sourceChain":"ethereum-sepolia","destinationChain":"base-sepolia","sourceAsset":"sepolia-usdc","destinationAsset":"base-sepolia-usdc","sourceDomain":0,"destinationDomain":6,"sourceSymbol":"USDC","destinationSymbol":"USDC","sourceDecimals":6,"destinationDecimals":6,"sourceTokenContract":"0x1c7d4b196cb0c7b01d743fbc6116a902379c7238","destinationTokenContract":"0x036cbd53842c5426634e7929541ec2318f3dcf7e","sourceContract":"0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa","destinationContract":"0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa","sourceExplorerUrl":"https://sepolia.etherscan.io/address/0x1c7d4b196cb0c7b01d743fbc6116a902379c7238","destinationExplorerUrl":"https://base-sepolia.blockscout.com/address/0x036cbd53842c5426634e7929541ec2318f3dcf7e","finalityThreshold":1000,"estimatedMinSeconds":15,"estimatedMaxSeconds":300,"connectivityProbeEnabled":true,"routeSupportVerified":true,"contractsVerified":true,"agreementApproved":false,"operationalReviewApproved":false,"routeSupportEvidenceUrl":"https://developers.circle.com/cctp/references/contract-addresses","agreementEvidenceUrl":"","operationalReviewUrl":"","license":"not-approved","termsUrl":"https://www.circle.com/legal/developer-terms","jurisdiction":"not-approved","dataRetention":"not-reviewed","dataRights":"not-reviewed","fallback":"none","outageMode":"route-unavailable"}]'
cat >"$bridge_env_stage" <<EOF
YNX_BRIDGE_DEPLOY_ENABLED=true
YNX_BRIDGE_API_KEY=$api_key
YNX_BRIDGE_GATEWAY_API_KEY=$gateway_key
YNX_BRIDGE_QUOTE_SEAL_KEY=$quote_seal_key
YNX_BRIDGE_RELAYERS_JSON='{"relayer-a":"$relayer_a","relayer-b":"$relayer_b"}'
YNX_BRIDGE_ROUTE_POLICIES_JSON='$route_policies_json'
YNX_BRIDGE_PROVIDER_ROUTES_JSON='$provider_routes_json'
YNX_BRIDGE_RELAYER_THRESHOLD=2
YNX_BRIDGE_HTTP_ADDR=127.0.0.1:6433
YNX_BRIDGE_RATE_LIMIT_WINDOW=1m
YNX_BRIDGE_RATE_LIMIT_MAX=5000
YNX_BRIDGE_RETENTION_PERIOD=61320h
YNX_BRIDGE_STATE_PATH=/var/lib/ynx-chain/bridge/state.json
YNX_MUTATION_FREEZE_FILE=/var/lib/ynx-chain/mutation-freeze.json
EOF
chmod 0600 "$bridge_env_stage"

[[ -s /etc/ynx/ynx-app-gatewayd.env ]] || { echo "canonical App Gateway env is missing" >&2; exit 1; }
awk '!/^YNX_APP_GATEWAY_BRIDGE_URL=/ && !/^YNX_APP_GATEWAY_BRIDGE_API_KEY=/' /etc/ynx/ynx-app-gatewayd.env >"$app_env_stage"
printf 'YNX_APP_GATEWAY_BRIDGE_URL=http://127.0.0.1:6433\nYNX_APP_GATEWAY_BRIDGE_API_KEY=%s\n' "$gateway_key" >>"$app_env_stage"
chmod 0600 "$app_env_stage"

set -a
# shellcheck disable=SC1090
source "$bridge_env_stage"
set +a
"$release_dir/bin/ynx-bridged" --check-config >/dev/null
set -a
# shellcheck disable=SC1090
source "$app_env_stage"
set +a
"$release_dir/bin/ynx-app-gatewayd" --check-config >/dev/null

backup_if_present() {
  local source="$1" name="$2"
  if [[ -e "$source" || -L "$source" ]]; then
    cp -a "$source" "$backup_dir/$name"
  fi
}

backup_if_present /usr/local/bin/ynx-bridged ynx-bridged
backup_if_present /usr/local/bin/ynx-app-gatewayd ynx-app-gatewayd
backup_if_present /etc/ynx/ynx-bridged.env ynx-bridged.env
backup_if_present /etc/ynx/ynx-app-gatewayd.env ynx-app-gatewayd.env
backup_if_present /etc/systemd/system/ynx-bridged.service ynx-bridged.service

rollback_required=1
rollback() {
  local exit_code=$?
  trap - EXIT
  if [[ "$rollback_required" == "1" ]]; then
    echo "Bridge Testnet install failed; restoring prior App Gateway and Bridge files" >&2
    if [[ -f "$backup_dir/ynx-app-gatewayd" ]]; then install -m 0755 "$backup_dir/ynx-app-gatewayd" /usr/local/bin/ynx-app-gatewayd; fi
    if [[ -f "$backup_dir/ynx-app-gatewayd.env" ]]; then install -m 0600 "$backup_dir/ynx-app-gatewayd.env" /etc/ynx/ynx-app-gatewayd.env; fi
    if [[ -f "$backup_dir/ynx-bridged" ]]; then install -m 0755 "$backup_dir/ynx-bridged" /usr/local/bin/ynx-bridged; fi
    if [[ -f "$backup_dir/ynx-bridged.env" ]]; then install -m 0600 "$backup_dir/ynx-bridged.env" /etc/ynx/ynx-bridged.env; fi
    if [[ -f "$backup_dir/ynx-bridged.service" ]]; then install -m 0644 "$backup_dir/ynx-bridged.service" /etc/systemd/system/ynx-bridged.service; fi
    systemctl daemon-reload || true
    systemctl restart ynx-app-gatewayd || true
    if [[ -f "$backup_dir/ynx-bridged.service" ]]; then systemctl restart ynx-bridged || true; else systemctl disable --now ynx-bridged || true; fi
  fi
  exit "$exit_code"
}
trap rollback EXIT

install -m 0755 "$release_dir/bin/ynx-bridged" /usr/local/bin/ynx-bridged
install -m 0755 "$release_dir/bin/ynx-app-gatewayd" /usr/local/bin/ynx-app-gatewayd
install -m 0600 "$bridge_env_stage" /etc/ynx/ynx-bridged.env
install -m 0600 "$app_env_stage" /etc/ynx/ynx-app-gatewayd.env
install -m 0644 "$release_dir/systemd/ynx-bridged.service" /etc/systemd/system/ynx-bridged.service
rm -f "$bridge_env_stage" "$app_env_stage"

systemctl daemon-reload
systemctl enable ynx-bridged
systemctl restart ynx-bridged
systemctl restart ynx-app-gatewayd
YNX_LOCAL_SERVICE_CHECK_ATTEMPTS=20 YNX_LOCAL_SERVICE_CHECK_SLEEP_SECONDS=1 \
  bash "$release_dir/scripts/check-local-services.sh" primary "$expected_commit" "$expected_release" 6423 bridge
app_health="$(curl -fsS --max-time 8 http://127.0.0.1:6437/health)"
[[ "$app_health" == *'"service":"ynx-app-gatewayd"'* && "$app_health" == *'"bridge":{"ok":true'* ]] || {
  echo "App Gateway did not report a healthy Bridge upstream" >&2
  exit 1
}
provider_probe_verified=0
for provider_probe_attempt in 1 2 3; do
  if provider_registry="$(curl -fsS --max-time 8 http://127.0.0.1:6433/bridge/providers)" &&
    bridge_status="$(curl -fsS --max-time 8 http://127.0.0.1:6433/bridge/status)" &&
    PROVIDER_REGISTRY="$provider_registry" BRIDGE_STATUS="$bridge_status" python3 - <<'PY'
import json
import os

registry = json.loads(os.environ["PROVIDER_REGISTRY"])
status = json.loads(os.environ["BRIDGE_STATUS"])
providers = {entry["provider"]: entry for entry in registry["providers"]}
circle = providers.get("circle-cctp-v2")
ynx = providers.get("unapproved-testnet-candidate")
if not circle or not ynx:
    raise SystemExit("Bridge Provider Registry omitted the Circle probe or unavailable YNX route")
if (
    circle["health"] != "connected-live-fee-api"
    or not circle.get("lastSuccess")
    or circle["testnetStatus"] != "official-fee-api-connected-route-approval-incomplete"
    or circle["failureStatus"] != "provider-route-approval-incomplete"
    or circle["agreementApproved"]
    or circle["operationalReviewApproved"]
    or not circle["routeSupportVerified"]
    or not circle["contractsConfigured"]
    or circle["routeAvailable"]
    or circle["executable"]
):
    raise SystemExit("Circle connectivity evidence overclaims approval or execution")
if (
    ynx["health"] != "not-connected"
    or ynx["contractsConfigured"]
    or ynx["routeAvailable"]
    or ynx["executable"]
):
    raise SystemExit("unsupported YNX Provider route did not remain unavailable")
if (
    status["availableProviderCount"] != 1
    or status["providerConnection"] != "connected-live-provider-api-route-execution-disabled"
    or status["officialStablecoinRouteAvailable"]
    or status["externalSubmissionEnabled"]
    or status["userAssetMovementEnabled"]
    or status["deployedPublic"]
):
    raise SystemExit("Bridge status conflates Provider connectivity with route execution")
PY
  then
    provider_probe_verified=1
    break
  fi
  if [[ "$provider_probe_attempt" -lt 3 ]]; then
    systemctl restart ynx-bridged
    sleep 2
  fi
done
[[ "$provider_probe_verified" == "1" ]] || {
  echo "Circle connectivity probe did not pass within three bounded attempts" >&2
  exit 1
}

rollback_required=0
trap - EXIT
printf 'bridgeTestnetInstall=passed\nrelease=%s\ncommit=%s\nbridgeService=active\nappGatewayBridgeUpstream=healthy\nproviderConnectivityProbe=connected-live-fee-api\nynxRouteExecutable=false\nexternalSubmissionEnabled=false\n' "$expected_release" "$expected_commit"
