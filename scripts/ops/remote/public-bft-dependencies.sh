#!/usr/bin/env bash
set -Eeuo pipefail

operation="${1:?start or rollback is required}"
transaction_id="${2:?transaction id is required}"
commit="${3:?commit is required}"
bft_release="${4:?BFT release is required}"
migration_height="${5:?migration height is required}"
migration_hash="${6:?migration hash is required}"
evidence_root="${7:?evidence root is required}"
faucet_key="${8:-/etc/ynx/consensus-signers/faucet.key}"
faucet_address="${9:-0x0000000000000000000000000000000000000000}"
ai_key="${10:-/etc/ynx/consensus-signers/ai.key}"
ai_address="${11:-0x0000000000000000000000000000000000000000}"
pay_key="${12:-/etc/ynx/consensus-signers/pay.key}"
pay_address="${13:-0x0000000000000000000000000000000000000000}"
trust_key="${14:-/etc/ynx/consensus-signers/trust.key}"
trust_address="${15:-0x0000000000000000000000000000000000000000}"
resource_key="${16:-/etc/ynx/consensus-signers/resource.key}"
resource_address="${17:-0x0000000000000000000000000000000000000000}"
dependency_mode="${18:-legacy}"

fail() { echo "$1" >&2; exit 1; }

[[ "$operation" == "start" || "$operation" == "rollback" ]] || fail "invalid dependency operation"
[[ "$transaction_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]] || fail "invalid transaction id"
[[ "$commit" =~ ^[0-9a-f]{12}$ ]] || fail "invalid commit"
[[ "$bft_release" == "ynx-bft-gateway-${commit}" ]] || fail "BFT release mismatch"
[[ "$migration_height" =~ ^[0-9]+$ ]] && ((migration_height > 0)) || fail "invalid migration height"
migration_hash="${migration_hash#0x}"
migration_hash="$(printf '%s' "$migration_hash" | tr '[:upper:]' '[:lower:]')"
[[ "$migration_hash" =~ ^[0-9a-f]{64}$ ]] || fail "invalid migration block hash"
[[ "$evidence_root" == /* && "$evidence_root" != *..* && "$evidence_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid dependency evidence path"
[[ "$dependency_mode" == legacy || "$dependency_mode" == single-app-gateway ]] || fail "invalid explicit dependency mode"
if [[ "$dependency_mode" == single-app-gateway ]]; then
  [[ "$#" == 25 ]] || fail "single-App gateway requires every independent operator/runtime/backup pin and staged original package"
elif (($# > 18)); then
  fail "legacy dependencies cannot consume single-App operator pins or staging inputs"
fi
if [[ "$dependency_mode" == legacy ]]; then
for value in "$evidence_root" "$faucet_key" "$ai_key" "$pay_key" "$trust_key" "$resource_key"; do
  [[ "$value" == /* && "$value" != *..* && "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid dependency path"
done
for key in "$faucet_key" "$ai_key" "$pay_key" "$trust_key" "$resource_key"; do
  [[ "$key" == /etc/ynx/consensus-signers/* ]] || fail "signer keys must stay under /etc/ynx/consensus-signers"
done
for address in "$faucet_address" "$ai_address" "$pay_address" "$trust_address" "$resource_address"; do
  [[ "$address" =~ ^0x[0-9a-f]{40}$ ]] || fail "invalid signer address"
done
fi

candidate_root=/var/lib/ynx-chain/consensus-candidate
dependency_root="/var/lib/ynx-chain/public-bft-cutover/${transaction_id}/dependencies"
env_root="/etc/ynx/public-bft-cutover/${transaction_id}"
candidate_env="$env_root/candidate.env"
ownership="$env_root/ownership.json"
mutation_marker=/var/lib/ynx-chain/mutation-freeze.json
pause_marker=/var/lib/ynx-chain/block-production-pause.json
authoritative_index=/var/lib/ynx-chain/indexer/indexer-db.json
services=(
  ynx-bft-gateway-candidate.service
  ynx-bft-indexer-candidate.service
  ynx-bft-explorer-candidate.service
  ynx-bft-faucet-candidate.service
  ynx-bft-ai-candidate.service
  ynx-bft-pay-candidate.service
  ynx-bft-trust-candidate.service
  ynx-bft-resource-candidate.service
)

owned_file() {
  local file="$1"
  test -s "$file" && grep -Fq "\"transactionId\":\"${transaction_id}\"" "$file" && grep -Fq "\"commit\":\"${commit}\"" "$file" && grep -Fq "\"bftRelease\":\"${bft_release}\"" "$file"
}

owned_start_inputs() {
  owned_file "$ownership" &&
    grep -Fq "\"migrationHeight\":${migration_height}" "$ownership" &&
    grep -Fq "\"migrationBlockHash\":\"${migration_hash}\"" "$ownership" &&
    grep -Fq "\"faucetKeyPath\":\"${faucet_key}\"" "$ownership" &&
    grep -Fq "\"faucetAddress\":\"${faucet_address}\"" "$ownership" &&
    grep -Fq "\"aiKeyPath\":\"${ai_key}\"" "$ownership" &&
    grep -Fq "\"aiAddress\":\"${ai_address}\"" "$ownership" &&
    grep -Fq "\"payKeyPath\":\"${pay_key}\"" "$ownership" &&
    grep -Fq "\"payAddress\":\"${pay_address}\"" "$ownership" &&
    grep -Fq "\"trustKeyPath\":\"${trust_key}\"" "$ownership" &&
    grep -Fq "\"trustAddress\":\"${trust_address}\"" "$ownership" &&
    grep -Fq "\"resourceKeyPath\":\"${resource_key}\"" "$ownership" &&
    grep -Fq "\"resourceAddress\":\"${resource_address}\"" "$ownership"
}

write_unit() {
  local name="$1" description="$2" after="$3" binary="$4" extra_env="$5" write_paths="$6"
  cat >"/etc/systemd/system/$name" <<EOF
[Unit]
Description=$description
After=network-online.target $after
Wants=network-online.target $after

[Service]
User=ynx
Group=ynx
EnvironmentFile=/etc/ynx/ynx-chaind.env
$extra_env
EnvironmentFile=$candidate_env
ExecStart=$binary
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$write_paths

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "/etc/systemd/system/$name"
}

# The protocol's single-App RPC adapter only needs the existing gateway and
# the normal operator's private Comet RPC. No indexer, explorer, faucet or
# paused-product daemon/key/database is a dependency of this executable.
single_app_gateway() {
  local operator_pin="$1" runtime_commit="$2" runtime_pin="$3" gateway_pin="$4" verifier_pin="$5" stage="$6" backup_pin="$7"
  local operator_unit=ynx-consensus-operator-candidate.service gateway_unit=ynx-bft-gateway-candidate.service
  local installed_unit="/etc/systemd/system/$operator_unit" unit="/etc/systemd/system/$gateway_unit"
  local expected_operator="$stage/package/roles/primary/systemd/$operator_unit"
  local attempt="$dependency_root/gateway-start-attempt" launcher="$dependency_root/start-gateway.sh"
  local pin file source destination
  local intent rollback_attempt="$dependency_root/gateway-rollback-attempt"
  for pin in "$operator_pin" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$backup_pin"; do
    [[ "$pin" =~ ^[0-9a-f]{64}$ && "$pin" != "$(printf '0%.0s' {1..64})" ]] || fail "single-App gateway requires nonzero independent SHA256 pins"
  done
  [[ "$runtime_commit" =~ ^[0-9a-f]{40}$ && "${runtime_commit:0:12}" == "$commit" ]] || fail "gateway runtime source differs from transaction commit"
  [[ "$stage" =~ ^/[A-Za-z0-9._/-]+$ && "$stage" != *..* && "$stage" != / ]] || fail "invalid gateway staged original source path"
  test -d "$stage" && test ! -L "$stage" && [[ "$(realpath -e "$stage")" == "$stage" ]] || fail "gateway stage must be an original canonical directory"
  [[ "$(stat -c %a "$stage")" == 700 && "$(stat -c %U "$stage")" == root ]] || fail "gateway stage must remain private root-owned original material"
  for file in "$stage/runtime-SOURCE.json" "$stage/ynx-bft-gatewayd" "$stage/ynx-consensus-package"; do
    test -f "$file" && test ! -L "$file" && [[ "$(realpath -e "$file")" == "$file" && "$(stat -c %h "$file")" == 1 ]] || fail "gateway runtime input must remain an original single-link file"
  done
  printf '%s  %s\n' "$runtime_pin" "$stage/runtime-SOURCE.json" "$gateway_pin" "$stage/ynx-bft-gatewayd" "$verifier_pin" "$stage/ynx-consensus-package" | sha256sum --strict -c - >/dev/null || fail "gateway original runtime bytes differ from independent pins"
  # The original runtime producer emits sorted compact JSON. Bind the copied
  # files to that independently pinned SOURCE as well as to the driver's pins;
  # unrelated individually valid artifacts cannot be combined accidentally.
  (( $(stat -c %s "$stage/runtime-SOURCE.json") <= 131072 )) || fail "runtime SOURCE exceeds original manifest bound"
  grep -Fq '"version":"YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2"' "$stage/runtime-SOURCE.json" && grep -Fq '"platform":"linux/amd64"' "$stage/runtime-SOURCE.json" && grep -Fq "\"commit\":\"$runtime_commit\"" "$stage/runtime-SOURCE.json" || fail "original gateway runtime SOURCE identity differs"
  grep -Fq "\"ynx-bft-gatewayd\":{\"bytes\":$(stat -c %s "$stage/ynx-bft-gatewayd"),\"sha256\":\"$gateway_pin\"}" "$stage/runtime-SOURCE.json" && grep -Fq "\"ynx-consensus-package\":{\"bytes\":$(stat -c %s "$stage/ynx-consensus-package"),\"sha256\":\"$verifier_pin\"}" "$stage/runtime-SOURCE.json" || fail "gateway binaries differ from independently pinned original runtime SOURCE records"
  test -x "$stage/ynx-consensus-package" && test -x "$stage/ynx-bft-gatewayd" || fail "original gateway and normal package verifier executables are required"
  # The driver validated the original complete eight-ELF SOURCE before staging
  # these exact two binaries. The complete original package is checked again by
  # that exact normal verifier; a per-role package is not a replacement.
  env -i PATH=/usr/bin:/bin "$stage/ynx-consensus-package" -verify-package "$stage/package" -operator-plan-hash "$operator_pin" >/dev/null || fail "normal independently pinned single-App operator package verification failed"
  test -f "$installed_unit" && test ! -L "$installed_unit" || fail "installed single-App operator unit is required; no legacy fallback"
  cmp "$expected_operator" "$installed_unit" >/dev/null || fail "installed single-App operator unit differs from the verified original package"
  test -d "$candidate_root" && test ! -L "$candidate_root" && [[ "$(realpath -e "$candidate_root")" == "$candidate_root" ]] || fail "installed original operator root must remain canonical"
  for source in "$stage/package/roles/primary/role-manifest.json" "$stage/package/roles/primary/scripts/start-operator.sh" "$stage/package/roles/primary/config/"*; do
    test -f "$source" && test ! -L "$source" || fail "verified original operator input is missing"
    case "$source" in
      */role-manifest.json) destination="$candidate_root/role-manifest.json" ;;
      */scripts/start-operator.sh) destination="$candidate_root/scripts/start-operator.sh" ;;
      */config/*) destination="$candidate_root/config/$(basename "$source")" ;;
      *) fail "unexpected original operator input" ;;
    esac
    test -f "$destination" && test ! -L "$destination" && [[ "$(realpath -e "$destination")" == "$destination" ]] || fail "installed original operator input is missing or aliased"
    cmp "$source" "$destination" >/dev/null || fail "installed original operator input differs from verified package"
  done
  [[ "$(systemctl show -p FragmentPath --value "$operator_unit")" == "$installed_unit" ]] || fail "single-App operator is loaded from a different unit"
  test -z "$(systemctl show -p DropInPaths --value "$operator_unit")" || fail "single-App operator drop-ins are not authorized"
  ! systemctl is-active --quiet ynx-consensus-abci-candidate.service || fail "legacy ABCI unit is active; refusing gateway fallback"
  ! systemctl is-active --quiet ynx-consensus-comet-candidate.service || fail "legacy Comet unit is active; refusing gateway fallback"
  owned_file "$mutation_marker" || fail "owned original mutation freeze marker is required"
  owned_file "$pause_marker" || fail "owned original authoritative pause marker is required"
  test -f "$evidence_root/primary.tar.gz" && test ! -L "$evidence_root/primary.tar.gz" || fail "retained original primary backup is required"
  printf '%s  %s\n' "$backup_pin" "$evidence_root/primary.tar.gz" | sha256sum --strict -c - >/dev/null || fail "original primary backup differs from independent activation evidence"
  printf -v intent '{"transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","migrationHeight":%s,"migrationBlockHash":"%s","operatorPlanSHA256":"%s","runtimeCommit":"%s","runtimeSOURCEsha256":"%s","gatewaySHA256":"%s","packageVerifierSHA256":"%s","backupSHA256":"%s","status":"unknown","automaticRetry":false}' "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$backup_pin"
  if [[ "$operation" == rollback ]]; then
    test -f "$attempt/intent.json" && test ! -L "$attempt/intent.json" && owned_file "$attempt/intent.json" || fail "original gateway start attempt is required for rollback"
    printf '%s\n' "$intent" | cmp "$attempt/intent.json" - >/dev/null || fail "gateway rollback inputs differ from original activation attempt"
    test -f "$unit" && test ! -L "$unit" && cmp "$attempt/gateway.service" "$unit" >/dev/null || fail "gateway rollback refuses a foreign or changed unit"
    test -f "$launcher" && test ! -L "$launcher" && cmp "$attempt/start-gateway.sh" "$launcher" >/dev/null && cmp "$attempt/candidate.env" "$candidate_env" >/dev/null || fail "gateway rollback refuses changed launcher or environment"
    test -f "$candidate_root/bin/ynx-bft-gatewayd" && test ! -L "$candidate_root/bin/ynx-bft-gatewayd" || fail "original installed gateway binary is required"
    printf '%s  %s\n' "$gateway_pin" "$candidate_root/bin/ynx-bft-gatewayd" | sha256sum --strict -c - >/dev/null || fail "gateway rollback refuses a changed original executable"
    [[ "$(systemctl show -p FragmentPath --value "$gateway_unit")" == "$unit" ]] && test -z "$(systemctl show -p DropInPaths --value "$gateway_unit")" || fail "gateway unit loading differs from original attempt"
    test ! -e "$evidence_root/primary-dependencies-rollback.json" && test ! -L "$evidence_root/primary-dependencies-rollback.json" || fail "gateway rollback result already exists; reconcile original outcome without retry"
    mkdir -m 0700 "$rollback_attempt" || fail "gateway rollback attempt exists (possibly UNKNOWN); reconcile without retry"
    printf '%s\n' "$intent" >"$rollback_attempt/intent.json"
    sync -f "$rollback_attempt/intent.json"
    timeout 30s systemctl stop "$gateway_unit"
    systemctl disable "$gateway_unit" >/dev/null
    ! systemctl is-active --quiet "$gateway_unit" || fail "candidate gateway remains active after rollback"
    (umask 077; set -o noclobber; printf '{"version":"YNX-SINGLE-APP-GATEWAY-ROLLBACK/v1","transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","migrationHeight":%s,"migrationBlockHash":"%s","operatorPlanSHA256":"%s","runtimeCommit":"%s","runtimeSOURCEsha256":"%s","gatewaySHA256":"%s","packageVerifierSHA256":"%s","backupSHA256":"%s","gatewayStopped":true,"originalMaterialRetained":true,"rolledBack":true}\n' "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$backup_pin" >"$evidence_root/primary-dependencies-rollback.json") || fail "gateway rollback result exists; retain and reconcile original outcome"
    sync -f "$evidence_root/primary-dependencies-rollback.json"
    printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nmode=single-app-gateway\noperatorPlanSHA256=%s\nruntimeCommit=%s\nruntimeSOURCEsha256=%s\ngatewaySHA256=%s\npackageVerifierSHA256=%s\nbackupSHA256=%s\ngatewayStopped=true\noriginalMaterialRetained=true\nrolledBack=true\n' "$transaction_id" "$commit" "$bft_release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$backup_pin"
    return
  fi
  systemctl is-active --quiet "$operator_unit" || fail "verified single-App operator is not active"
  test ! -e "$unit" && test ! -L "$unit" && test ! -e "$candidate_root/bin/ynx-bft-gatewayd" && test ! -L "$candidate_root/bin/ynx-bft-gatewayd" || fail "gateway unit or binary already exists; retain original outcome without retry"
  test ! -e "$dependency_root" && test ! -L "$dependency_root" && test ! -e "$env_root" && test ! -L "$env_root" || fail "gateway activation attempt or dependency material already exists; reconcile UNKNOWN without retry"
  test ! -e "$evidence_root/primary-dependencies-start.json" && test ! -L "$evidence_root/primary-dependencies-start.json" || fail "gateway start result already exists; reconcile original outcome without retry"
  ! systemctl is-active --quiet "$gateway_unit" || fail "candidate gateway already has an active service"
  test -z "$(systemctl show -p FragmentPath --value "$gateway_unit")" && test -z "$(systemctl show -p DropInPaths --value "$gateway_unit")" || fail "candidate gateway already has loaded unit material; retain original state"
  ! ss -ltn | awk '{print $4}' | grep -Eq ':27620$' || fail "candidate gateway port is already in use"
  # Reserve before installing any executable/unit. Every partial/UNKNOWN result
  # remains in place; neither a failed command nor rollback deletes evidence.
  umask 077
  if [[ ! -e "$(dirname "$dependency_root")" ]]; then install -d -m 0755 -o root -g root "$(dirname "$dependency_root")"; fi
  test -d "$(dirname "$dependency_root")" && test ! -L "$(dirname "$dependency_root")" && [[ "$(realpath -e "$(dirname "$dependency_root")")" == "$(dirname "$dependency_root")" ]] || fail "gateway dependency parent is not an original directory"
  mkdir -m 0750 "$dependency_root"
  chown root:ynx "$dependency_root"
  mkdir -m 0700 "$attempt"
  if [[ ! -e "$(dirname "$env_root")" ]]; then install -d -m 0755 "$(dirname "$env_root")"; fi
  test -d "$(dirname "$env_root")" && test ! -L "$(dirname "$env_root")" && [[ "$(realpath -e "$(dirname "$env_root")")" == "$(dirname "$env_root")" ]] || fail "gateway environment parent is not an original directory"
  mkdir -m 0750 "$env_root"
  chown root:ynx "$env_root"
  printf '%s\n' "$intent" >"$attempt/intent.json"
  cat >"$candidate_env" <<EOF
YNX_BFT_GATEWAY_HTTP_ADDR=127.0.0.1:27620
YNX_BFT_GATEWAY_COMET_RPC_URL=http://127.0.0.1:27757
YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false
YNX_BFT_GATEWAY_MIGRATION_HEIGHT=$migration_height
YNX_BFT_GATEWAY_MIGRATION_BLOCK_HASH=$migration_hash
EOF
  chmod 0640 "$candidate_env"
  chown root:ynx "$candidate_env"
  cat >"$launcher" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
authorized="\$(/usr/bin/sed -n 's/^YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=//p' '$candidate_env')"
case "\$authorized" in true|false) ;; *) exit 1 ;; esac
exec env -i PATH=/usr/bin:/bin YNX_MUTATION_FREEZE_FILE=$mutation_marker \\
  "$candidate_root/bin/ynx-bft-gatewayd" --http 127.0.0.1:27620 --comet-rpc http://127.0.0.1:27757 \\
  --migration-height "$migration_height" --migration-block-hash "$migration_hash" \\
  --public-cutover-authorized="\$authorized"
EOF
  chmod 0750 "$launcher"
  chown root:ynx "$launcher"
  runuser -u ynx -- test -r "$candidate_env" || fail "normal non-root gateway user cannot read its exact private configuration; retain partial attempt"
  runuser -u ynx -- test -r "$launcher" || fail "normal non-root gateway user cannot read its exact launcher; retain partial attempt"
  cat >"$attempt/gateway.service" <<EOF
[Unit]
Description=YNX single-App protocol RPC gateway ($transaction_id)
After=network-online.target $operator_unit
Wants=network-online.target
Requires=$operator_unit

[Service]
Type=simple
User=ynx
Group=ynx
UMask=0077
ExecStart=/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash $launcher
Restart=no
KillMode=control-group
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  chmod 0600 "$attempt/gateway.service"
  cp "$candidate_env" "$attempt/candidate.env"
  cp "$launcher" "$attempt/start-gateway.sh"
  dd if="$stage/ynx-bft-gatewayd" of="$candidate_root/bin/ynx-bft-gatewayd" conv=excl status=none
  chmod 0755 "$candidate_root/bin/ynx-bft-gatewayd"
  dd if="$attempt/gateway.service" of="$unit" conv=excl status=none
  chmod 0644 "$unit"
  printf '%s  %s\n' "$gateway_pin" "$candidate_root/bin/ynx-bft-gatewayd" | sha256sum --strict -c - >/dev/null
  cmp "$attempt/gateway.service" "$unit" >/dev/null
  sync -f "$attempt/intent.json"
  sync -f "$unit"
  sync -f "$candidate_root/bin/ynx-bft-gatewayd"
  sync -f "$candidate_env"
  sync -f "$launcher"
  systemctl daemon-reload
  [[ "$(systemctl show -p FragmentPath --value "$gateway_unit")" == "$unit" ]] && test -z "$(systemctl show -p DropInPaths --value "$gateway_unit")" || fail "gateway unit loading differs from exact original bytes"
  timeout 30s systemctl start "$gateway_unit"
  systemctl is-active --quiet "$gateway_unit" || fail "candidate gateway did not become active"
  local ready=false
  for _attempt in $(seq 1 30); do
    if curl --noproxy '*' --max-time 5 -fsS http://127.0.0.1:27620/health >/dev/null; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail "candidate single-App gateway health failed"
  cmp "$attempt/gateway.service" "$unit" >/dev/null && cmp "$attempt/candidate.env" "$candidate_env" >/dev/null && cmp "$attempt/start-gateway.sh" "$launcher" >/dev/null || fail "gateway activation files changed during startup; retain UNKNOWN"
  [[ "$(systemctl show -p FragmentPath --value "$gateway_unit")" == "$unit" ]] && test -z "$(systemctl show -p DropInPaths --value "$gateway_unit")" || fail "gateway loaded unit changed during startup; retain UNKNOWN"
  local main_pid loaded_exec expected_exec running_pin running_inode unit_pin launcher_pin environment_pin
  loaded_exec="$(systemctl show -p ExecStart --value "$gateway_unit")"
  expected_exec="{ path=/usr/bin/env ; argv[]=/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash $launcher ; ignore_errors=no ; "
  [[ "$loaded_exec" == "$expected_exec"* && "${loaded_exec#"$expected_exec"}" != *'argv[]='* ]] || fail "gateway loaded ExecStart differs from the fixed env-i launcher; retain UNKNOWN"
  main_pid="$(systemctl show -p MainPID --value "$gateway_unit")"
  [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] && ((main_pid > 1)) || fail "gateway has no actual running MainPID; retain UNKNOWN"
  # /proc is the actual running inode, not an installed file or a substituted
  # path. A protected-runtime refusal is retained and blocks this result; there
  # is no debugger, copied-executable or higher-permission fallback.
  running_inode="$(stat -Lc '%d:%i' "/proc/$main_pid/exe")" || fail "cannot read actual gateway running inode; retain UNKNOWN without fallback"
  running_pin="$(sha256sum "/proc/$main_pid/exe" | awk '{print $1}')" || fail "cannot hash actual gateway running inode; retain UNKNOWN without fallback"
  [[ "$running_pin" == "$gateway_pin" ]] || fail "actual running gateway differs from independent runtime binary pin; retain UNKNOWN"
  printf '%s\0' "$candidate_root/bin/ynx-bft-gatewayd" --http 127.0.0.1:27620 --comet-rpc http://127.0.0.1:27757 --migration-height "$migration_height" --migration-block-hash "$migration_hash" --public-cutover-authorized=false | cmp "/proc/$main_pid/cmdline" - >/dev/null || fail "actual gateway argv differs from approved private RPC path; retain UNKNOWN"
  printf '%s\0' PATH=/usr/bin:/bin "YNX_MUTATION_FREEZE_FILE=$mutation_marker" | cmp "/proc/$main_pid/environ" - >/dev/null || fail "actual gateway environment differs from isolated mutation-frozen launch; retain UNKNOWN"
  [[ "$(systemctl show -p MainPID --value "$gateway_unit")" == "$main_pid" && "$(stat -Lc '%d:%i' "/proc/$main_pid/exe")" == "$running_inode" ]] || fail "actual gateway process changed during source observation; retain UNKNOWN"
  unit_pin="$(sha256sum "$unit" | awk '{print $1}')"
  launcher_pin="$(sha256sum "$launcher" | awk '{print $1}')"
  environment_pin="$(sha256sum "$candidate_env" | awk '{print $1}')"
  (umask 077; set -o noclobber; printf '{"version":"YNX-SINGLE-APP-GATEWAY-START/v1","transactionId":"%s","commit":"%s","bftRelease":"%s","mode":"single-app-gateway","migrationHeight":%s,"migrationBlockHash":"%s","operatorPlanSHA256":"%s","runtimeCommit":"%s","runtimeSOURCEsha256":"%s","gatewaySHA256":"%s","packageVerifierSHA256":"%s","backupSHA256":"%s","unitSHA256":"%s","launcherSHA256":"%s","environmentSHA256":"%s","mainPid":"%s","runningExecutableSHA256":"%s","runningExecutableDeviceInode":"%s","parallelCandidateOnly":true,"dependenciesActive":true,"publicIngressChanged":false,"pqActivationVerified":false,"reused":false}\n' "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$backup_pin" "$unit_pin" "$launcher_pin" "$environment_pin" "$main_pid" "$running_pin" "$running_inode" >"$evidence_root/primary-dependencies-start.json") || fail "gateway start result exists; retain and reconcile original outcome"
  dd if="$evidence_root/primary-dependencies-start.json" of="$ownership" conv=excl status=none
  chmod 0600 "$ownership"
  sync -f "$ownership"
  sync -f "$evidence_root/primary-dependencies-start.json"
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nmode=single-app-gateway\noperatorPlanSHA256=%s\nruntimeCommit=%s\nruntimeSOURCEsha256=%s\ngatewaySHA256=%s\npackageVerifierSHA256=%s\nbackupSHA256=%s\ndependenciesActive=true\nparallelCandidateOnly=true\npublicIngressChanged=false\npqActivationVerified=false\nreused=false\n' "$transaction_id" "$commit" "$bft_release" "$operator_pin" "$runtime_commit" "$runtime_pin" "$gateway_pin" "$verifier_pin" "$backup_pin"
}

if [[ "$dependency_mode" == single-app-gateway ]]; then
  single_app_gateway "${19}" "${20}" "${21}" "${22}" "${23}" "${24}" "${25}"
  exit 0
fi

rollback_dependencies() {
  local unit
  if [[ -e "$ownership" ]] && ! owned_file "$ownership"; then
    fail "dependency ownership belongs to another transaction"
  fi
  for unit in "${services[@]}"; do
    if [[ -e "/etc/systemd/system/$unit" ]]; then
      grep -Fq "EnvironmentFile=$candidate_env" "/etc/systemd/system/$unit" || fail "refusing to remove foreign dependency unit $unit"
    fi
  done
  systemctl disable --now "${services[@]}" >/dev/null 2>&1 || true
  rm -f "${services[@]/#//etc/systemd/system/}"
  systemctl daemon-reload
  rm -rf "$env_root" "$dependency_root"
  for unit in "${services[@]}"; do
    ! systemctl is-active --quiet "$unit" || fail "candidate dependency service remains active: $unit"
  done
  for service in ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
    systemctl is-active "$service" >/dev/null || fail "authoritative service is not active after dependency rollback: $service"
  done
  ! ss -ltn | awk '{print $4}' | grep -Eq ':(27620|27626|27627|27628|27629|27630|27631|27632)$' || fail "candidate dependency port remains open"
  install -d -m 0700 "$evidence_root"
  printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","authoritativeServicesActive":true,"candidateDependencyServicesAbsent":true,"candidatePortsFree":true,"rolledBack":true,"recordedAt":"%s"}\n' \
    "$transaction_id" "$commit" "$bft_release" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_root/primary-dependencies-rollback.json"
  chmod 0600 "$evidence_root/primary-dependencies-rollback.json"
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nauthoritativeServicesActive=true\ncandidateDependencyServicesAbsent=true\ncandidatePortsFree=true\nrolledBack=true\n' "$transaction_id" "$commit" "$bft_release"
}

if [[ "$operation" == "rollback" ]]; then
  rollback_dependencies
  exit 0
fi

if [[ -e "$ownership" ]]; then
  owned_start_inputs || fail "existing dependency state does not match the approved start inputs"
  for service in "${services[@]}"; do systemctl is-active "$service" >/dev/null; done
  printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nreused=true\ndependenciesActive=true\n' "$transaction_id" "$commit" "$bft_release"
  exit 0
fi

owned_file "$mutation_marker" || fail "owned mutation freeze marker is required"
owned_file "$pause_marker" || fail "owned authoritative pause marker is required"
for service in ynx-chaind ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service; do
  systemctl is-active "$service" >/dev/null || fail "required service is not active: $service"
done
for binary in ynx-bft-gatewayd ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  test -x "$candidate_root/bin/$binary" || fail "transaction candidate binary is missing: $binary"
done
for key in "$faucet_key" "$ai_key" "$pay_key" "$trust_key" "$resource_key"; do
  test -s "$key" || fail "signer key is missing"
  [[ "$(stat -c %a "$key")" == 600 ]] || fail "signer key must be mode 0600"
  [[ "$(stat -c %U "$key")" == ynx ]] || fail "signer key must be owned by ynx"
done

for _attempt in $(seq 1 20); do
  health="$(curl -fsS http://127.0.0.1:6426/health)" || true
  indexed="$(printf '%s' "$health" | sed -n 's/.*"lastIndexedHeight":[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
  [[ "$indexed" == "$migration_height" ]] && break
  sleep 1
done
[[ "${indexed:-}" == "$migration_height" ]] || fail "authoritative indexer did not reach the final snapshot height"
test -s "$authoritative_index" || fail "authoritative index database is missing"
indexed_hash="$(sed -n 's/.*"lastBlockHash":[[:space:]]*"\([0-9a-fA-F]\{64\}\)".*/\1/p' "$authoritative_index" | head -1 | tr '[:upper:]' '[:lower:]')"
[[ "$indexed_hash" == "$migration_hash" ]] || fail "authoritative index tip does not match the final snapshot hash"

umask 077
install -d -m 0700 -o ynx -g ynx "$dependency_root/indexer" "$dependency_root/log"
install -m 0600 -o ynx -g ynx "$authoritative_index" "$dependency_root/indexer/indexer-db.json"
install -d -m 0700 "$env_root"
cat >"$candidate_env" <<EOF
YNX_BFT_GATEWAY_HTTP_ADDR=127.0.0.1:27620
YNX_BFT_GATEWAY_COMET_RPC_URL=http://127.0.0.1:27757
YNX_BFT_GATEWAY_PUBLIC_CUTOVER_AUTHORIZED=false
YNX_BFT_GATEWAY_MIGRATION_HEIGHT=$migration_height
YNX_BFT_GATEWAY_MIGRATION_BLOCK_HASH=$migration_hash
YNX_INDEXER_RPC_URL=http://127.0.0.1:27620
YNX_INDEXER_HTTP_ADDR=127.0.0.1:27626
YNX_INDEXER_DB_PATH=$dependency_root/indexer/indexer-db.json
YNX_EXPLORER_RPC_URL=http://127.0.0.1:27620
YNX_EXPLORER_INDEXER_URL=http://127.0.0.1:27626
YNX_EXPLORER_HTTP_ADDR=127.0.0.1:27627
YNX_FAUCET_RPC_URL=http://127.0.0.1:27620
YNX_FAUCET_HTTP_ADDR=127.0.0.1:27628
YNX_FAUCET_UPSTREAM_MODE=bft
FAUCET_PRIVATE_KEY=
YNX_FAUCET_PRIVATE_KEY_FILE=$faucet_key
YNX_FAUCET_ADDRESS=$faucet_address
YNX_FAUCET_REQUEST_LOG=$dependency_root/log/faucet.jsonl
YNX_AI_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_AI_GATEWAY_HTTP_ADDR=127.0.0.1:27629
YNX_AI_GATEWAY_UPSTREAM_MODE=bft
YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$ai_key
YNX_AI_GATEWAY_SIGNER_ADDRESS=$ai_address
YNX_AI_GATEWAY_AUDIT_LOG=$dependency_root/log/ai.jsonl
YNX_PAY_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_PAY_GATEWAY_HTTP_ADDR=127.0.0.1:27630
YNX_PAY_GATEWAY_UPSTREAM_MODE=bft
YNX_PAY_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_PAY_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$pay_key
YNX_PAY_GATEWAY_SIGNER_ADDRESS=$pay_address
YNX_PAY_GATEWAY_AUDIT_LOG=$dependency_root/log/pay.jsonl
YNX_TRUST_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_TRUST_GATEWAY_HTTP_ADDR=127.0.0.1:27631
YNX_TRUST_GATEWAY_UPSTREAM_MODE=bft
YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$trust_key
YNX_TRUST_GATEWAY_SIGNER_ADDRESS=$trust_address
YNX_TRUST_GATEWAY_AUDIT_LOG=$dependency_root/log/trust.jsonl
YNX_RESOURCE_GATEWAY_CHAIN_URL=http://127.0.0.1:27620
YNX_RESOURCE_GATEWAY_HTTP_ADDR=127.0.0.1:27632
YNX_RESOURCE_GATEWAY_UPSTREAM_MODE=bft
YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY=
YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY_FILE=$resource_key
YNX_RESOURCE_GATEWAY_SIGNER_ADDRESS=$resource_address
YNX_RESOURCE_GATEWAY_AUDIT_LOG=$dependency_root/log/resource.jsonl
EOF
chmod 0640 "$candidate_env"
chown root:ynx "$candidate_env"
printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","migrationHeight":%s,"migrationBlockHash":"%s","faucetKeyPath":"%s","faucetAddress":"%s","aiKeyPath":"%s","aiAddress":"%s","payKeyPath":"%s","payAddress":"%s","trustKeyPath":"%s","trustAddress":"%s","resourceKeyPath":"%s","resourceAddress":"%s"}\n' \
  "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$faucet_key" "$faucet_address" "$ai_key" "$ai_address" "$pay_key" "$pay_address" "$trust_key" "$trust_address" "$resource_key" "$resource_address" >"$ownership"
chmod 0600 "$ownership"

write_unit ynx-bft-gateway-candidate.service "YNX BFT candidate compatibility gateway" ynx-consensus-comet-candidate.service "$candidate_root/bin/ynx-bft-gatewayd" "" "$candidate_root $dependency_root"
write_unit ynx-bft-indexer-candidate.service "YNX BFT candidate indexer" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-indexerd" "" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-explorer-candidate.service "YNX BFT candidate explorer" ynx-bft-indexer-candidate.service "$candidate_root/bin/ynx-explorerd" "" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-faucet-candidate.service "YNX BFT candidate faucet" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-faucetd" "EnvironmentFile=/etc/ynx/ynx-faucetd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-ai-candidate.service "YNX BFT candidate AI Gateway" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-ai-gatewayd" "EnvironmentFile=/etc/ynx/ynx-ai-gatewayd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-pay-candidate.service "YNX BFT candidate Pay API" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-payd" "EnvironmentFile=/etc/ynx/ynx-payd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-trust-candidate.service "YNX BFT candidate Trust API" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-trustd" "EnvironmentFile=/etc/ynx/ynx-trustd.env" "$dependency_root /var/log/ynx-chain"
write_unit ynx-bft-resource-candidate.service "YNX BFT candidate Resource API" ynx-bft-gateway-candidate.service "$candidate_root/bin/ynx-resourced" "EnvironmentFile=/etc/ynx/ynx-resourced.env" "$dependency_root /var/log/ynx-chain"

systemctl daemon-reload
systemctl enable --now "${services[@]}" >/dev/null
for port in 27620 27626 27627 27628 27629 27630 27631 27632; do
  ready=false
  for _attempt in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail "candidate dependency health failed on port $port"
done

install -d -m 0700 "$evidence_root"
printf '{"transactionId":"%s","commit":"%s","bftRelease":"%s","migrationHeight":%s,"migrationBlockHash":"%s","authoritativeIndexerBoundaryVerified":true,"parallelCandidatePorts":true,"dependenciesActive":true,"reused":false,"recordedAt":"%s"}\n' \
  "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_root/primary-dependencies-start.json"
chmod 0600 "$evidence_root/primary-dependencies-start.json"
printf 'transactionId=%s\ncommit=%s\nbftRelease=%s\nmigrationHeight=%s\nmigrationBlockHash=%s\nauthoritativeIndexerBoundaryVerified=true\nparallelCandidatePorts=true\ndependenciesActive=true\nreused=false\n' "$transaction_id" "$commit" "$bft_release" "$migration_height" "$migration_hash"
