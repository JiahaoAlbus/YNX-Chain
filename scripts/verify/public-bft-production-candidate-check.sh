#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

bash -n scripts/ops/remote/public-bft-dependencies.sh
bash -n scripts/ops/remote/public-bft-ingress.sh
node scripts/verify/validate-public-bft-dependency-continuity.mjs --self-test
node scripts/verify/validate-public-bft-public-continuity.mjs --self-test

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
mkdir -p "$repo/scripts/ops/remote" "$repo/scripts/deploy" "$repo/scripts/verify" "$tmp/fake-bin"
cp scripts/ops/public-bft-production-driver.sh scripts/ops/rollback-consensus-candidate.sh scripts/ops/lib.sh "$repo/scripts/ops/"
cp scripts/ops/remote/public-bft-dependencies.sh scripts/ops/remote/public-bft-ingress.sh "$repo/scripts/ops/remote/"
cp scripts/deploy/deploy-consensus-candidate.sh scripts/deploy/lib.sh "$repo/scripts/deploy/"
cp scripts/verify/verify-consensus-candidate.sh scripts/verify/public-bft-candidate-binding.mjs scripts/verify/validate-public-bft-cutover-approval-evidence.mjs scripts/verify/validate-public-bft-public-continuity.mjs "$repo/scripts/verify/"

cat >"$tmp/fake-bin/go" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mode="${1:-}"
shift || true
if [[ "$mode" == "build" ]]; then
  output=""
  while (($#)); do
    if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
  done
  test -n "$output"
  mkdir -p "$(dirname "$output")"
  printf 'fixture binary\n' >"$output"
  chmod 0755 "$output"
  exit 0
fi
[[ "$mode" == "run" ]] || exit 1
output="" genesis=""
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  case "${args[$i]}" in
    -output) output="${args[$((i+1))]}" ;;
    -genesis-time) genesis="${args[$((i+1))]}" ;;
  esac
done
if [[ -n "$output" ]]; then
  mkdir -p "$output/roles"
  for role in primary singapore silicon-valley seoul; do
    mkdir -p "$output/roles/$role"
    printf '{"role":"%s"}\n' "$role" >"$output/roles/$role/role-manifest.json"
  done
  printf '{"version":1,"purpose":"fixture","chainId":"ynx_6423-1","candidateRoot":"/var/lib/ynx-chain/consensus-candidate","genesisHash":"%s","migrationStateHash":"%s","genesisTime":"%s","roles":["primary","singapore","silicon-valley","seoul"],"files":{}}\n' \
    "$(printf 'a%.0s' {1..64})" "$(printf 'b%.0s' {1..64})" "$genesis" >"$output/package-manifest.json"
fi
EOF
chmod 0755 "$tmp/fake-bin/go"

git -C "$repo" init -q -b main
git -C "$repo" add scripts
git -C "$repo" -c user.name='YNX self test' -c user.email='self-test@localhost' commit -q -m 'candidate production fixture'
commit="$(git -C "$repo" rev-parse --short=12 HEAD)"
release="ynx-bft-gateway-${commit}"
transaction="$tmp/cutover-${commit}-candidate"
mkdir -p "$transaction/final-snapshot"

cat >"$tmp/deploy.env" <<EOF
PRIMARY_NODE_HOST=primary.test
PRIMARY_NODE_USER=ubuntu
PRIMARY_NODE_SSH_KEY=$tmp/primary.pem
SG_NODE_HOST=singapore.test
SG_NODE_USER=root
SG_NODE_SSH_KEY=$tmp/singapore.pem
SILICON_VALLEY_NODE_HOST=silicon-valley.test
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$tmp/silicon-valley.pem
SEOUL_NODE_HOST=seoul.test
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$tmp/seoul.pem
EOF

recorded_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
genesis_time="$(date -u -v+10M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)"
expires_at="$(date -u -v+1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)"
block_hash="$(printf 'c%.0s' {1..64})"
state_hash="$(printf 'd%.0s' {1..64})"
cat >"$transaction/final-snapshot/migration.json" <<EOF
{"version":1,"sourceFormat":"ynx-devnet-state-v1","network":{"name":"YNX Testnet","slug":"testnet","chainId":6423,"nativeCoinName":"YNXT","nativeCurrencySymbol":"YNXT","decimals":18},"height":76234,"lastBlockHash":"$block_hash","accounts":[],"validators":[],"resourcePolicy":{},"liquidSupplyYnxt":0,"stakedSupplyYnxt":0,"stateHash":"$state_hash"}
EOF
snapshot_sha="$(shasum -a 256 "$transaction/final-snapshot/migration.json" | awk '{print $1}')"
cat >"$transaction/final-snapshot/remote-evidence.json" <<EOF
{"transactionId":"$(basename "$transaction")","commit":"$commit","authoritativeRelease":"ynx-chain-$commit","bftRelease":"$release","height":76234,"lastBlockHash":"$block_hash","stateHash":"$state_hash","sha256":"$snapshot_sha","pauseVerified":true,"mutationFreezeVerified":true,"validated":true,"reused":false,"recordedAt":"$recorded_at"}
EOF
cat >"$tmp/validator-manifest.json" <<'EOF'
{"version":1,"purpose":"ynx-production-bft-candidate-public-keys-only","chainId":"ynx_6423-1","validators":[{"role":"primary","privateP2PHost":"10.77.42.1"},{"role":"singapore","privateP2PHost":"10.77.42.2"},{"role":"silicon-valley","privateP2PHost":"10.77.42.3"},{"role":"seoul","privateP2PHost":"10.77.42.4"}]}
EOF
validator_sha="$(shasum -a 256 "$tmp/validator-manifest.json" | awk '{print $1}')"
cat >"$transaction/approval.json" <<EOF
{"schemaVersion":1,"action":"ynx-public-bft-cutover","approved":true,"approvalId":"fixture-$commit","approver":"transaction fixture","custodyReviewer":"custody fixture","custodyEvidence":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","owner":"owner fixture","ownerHandoverReviewer":"owner handover fixture","ownerHandoverInventoryDigest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","ownerHandoverInventoryEvidence":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","ownerHandoverReceiptEvidence":"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","commit":"$commit","release":"$release","publicCutoverAuthorized":true,"automaticRollbackRequired":true,"validatorKeyRecoveryVerified":true,"serviceSignerRecoveryVerified":true,"ownerHandoverVerified":true,"rotationProcedureVerified":true,"serviceSignerManifestSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","validatorManifestSha256":"$validator_sha","candidateGenesisTime":"$genesis_time","expiresAt":"$expires_at"}
EOF
chmod 0600 "$transaction/approval.json" "$transaction/final-snapshot/migration.json" "$transaction/final-snapshot/remote-evidence.json"

run_candidate() {
  local phase="$1" approval="${2:-yes}"
  (cd "$repo" && PATH="$tmp/fake-bin:$PATH" ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED="$approval" \
    PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST="$tmp/validator-manifest.json" \
    PUBLIC_BFT_PRODUCTION_CANDIDATE_GENESIS_TIME="$genesis_time" \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    bash scripts/ops/public-bft-production-driver.sh "$phase")
}

run_candidate deploy_candidate >/dev/null
test -s "$transaction/candidate/binding.json"
test -s "$transaction/candidate/deploy-result.json"
grep -Fq '"automaticRollbackRequired": true' "$transaction/candidate/binding.json"
grep -Fq 'stat -c %a' "$repo/scripts/deploy/deploy-consensus-candidate.sh"
grep -Fq "trap 'rm -f" "$repo/scripts/deploy/deploy-consensus-candidate.sh"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/candidate/deploy.txt"
  grep -Fq "/tmp/ynx-consensus-candidate-${commit}-${role}.tar.gz" "$transaction/candidate/deploy.txt"
done
while IFS= read -r archive; do
  mode="$(stat -f %Lp "$archive" 2>/dev/null || stat -c %a "$archive")"
  [[ "$mode" == "600" ]]
done < <(find "$transaction/candidate/deploy-work" -name '*.tar.gz' -type f)

run_candidate verify_candidate >/dev/null
test -s "$transaction/candidate/verify-result.json"
grep -Fq '"verified":true' "$transaction/candidate/verify-result.json"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/candidate/verify.txt"
done
run_candidate deploy_candidate >/dev/null
test -s "$transaction/candidate/deploy-reuse.txt"

run_dependencies() {
  local phase="$1" approval="${2:-yes}"
  (cd "$repo" && PATH="$tmp/fake-bin:$PATH" ENV_FILE="$tmp/deploy.env" DEPLOY_DRY_RUN=1 \
    PUBLIC_BFT_PRODUCTION_CANDIDATE_APPROVED=yes \
    PUBLIC_BFT_PRODUCTION_DEPENDENCIES_APPROVED="$approval" \
    PUBLIC_BFT_PRODUCTION_VALIDATOR_MANIFEST="$tmp/validator-manifest.json" \
    PUBLIC_BFT_PRODUCTION_CANDIDATE_GENESIS_TIME="$genesis_time" \
    PUBLIC_BFT_CUTOVER_COMMIT="$commit" \
    PUBLIC_BFT_CUTOVER_RELEASE="$release" \
    PUBLIC_BFT_CUTOVER_TRANSACTION_DIR="$transaction" \
    PUBLIC_BFT_FAUCET_SIGNER_KEY_FILE=/etc/ynx/consensus-signers/faucet.key \
    PUBLIC_BFT_FAUCET_SIGNER_ADDRESS=0x1111111111111111111111111111111111111111 \
    PUBLIC_BFT_AI_SIGNER_KEY_FILE=/etc/ynx/consensus-signers/ai.key \
    PUBLIC_BFT_AI_SIGNER_ADDRESS=0x2222222222222222222222222222222222222222 \
    PUBLIC_BFT_PAY_SIGNER_KEY_FILE=/etc/ynx/consensus-signers/pay.key \
    PUBLIC_BFT_PAY_SIGNER_ADDRESS=0x3333333333333333333333333333333333333333 \
    PUBLIC_BFT_TRUST_SIGNER_KEY_FILE=/etc/ynx/consensus-signers/trust.key \
    PUBLIC_BFT_TRUST_SIGNER_ADDRESS=0x4444444444444444444444444444444444444444 \
    PUBLIC_BFT_RESOURCE_SIGNER_KEY_FILE=/etc/ynx/consensus-signers/resource.key \
    PUBLIC_BFT_RESOURCE_SIGNER_ADDRESS=0x5555555555555555555555555555555555555555 \
    bash scripts/ops/public-bft-production-driver.sh "$phase")
}

run_dependencies start_dependencies >/dev/null
test -s "$transaction/dependencies/start-result.json"
grep -Fq 'parallelCandidateOnly' "$transaction/dependencies/start-result.json"
grep -Fq 'public-bft-dependencies' "$transaction/roles/primary-start-dependencies.txt"
grep -Fq '/etc/ynx/consensus-signers/faucet.key' "$transaction/roles/primary-start-dependencies.txt"
for binary in ynx-bft-gatewayd ynx-indexerd ynx-explorerd ynx-faucetd ynx-ai-gatewayd ynx-payd ynx-trustd ynx-resourced; do
  grep -Fq "\$candidate_root/bin/$binary" "$repo/scripts/ops/remote/public-bft-dependencies.sh"
done
for raw_key in FAUCET_PRIVATE_KEY YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY YNX_PAY_GATEWAY_SIGNER_PRIVATE_KEY YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY YNX_RESOURCE_GATEWAY_SIGNER_PRIVATE_KEY; do
  grep -Fxq "${raw_key}=" "$repo/scripts/ops/remote/public-bft-dependencies.sh"
done
run_dependencies verify_continuity >/dev/null
test -s "$transaction/dependencies/continuity-result.json"
grep -Fq 'publicIngressChanged' "$transaction/dependencies/continuity-result.json"
grep -Fq '127.0.0.1:27620/health' "$transaction/dependencies/continuity/gateway-before-health.json"
cp "$transaction/dependencies/start-result.json" "$tmp/start-result.valid"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.migrationBlockHash="f".repeat(64);fs.writeFileSync(p,JSON.stringify(v)+"\n",{mode:0o600})' "$transaction/dependencies/start-result.json"
if run_dependencies verify_continuity >/dev/null 2>&1; then
  echo "dependency continuity unexpectedly accepted a mismatched startup boundary" >&2
  exit 1
fi
mv "$tmp/start-result.valid" "$transaction/dependencies/start-result.json"

run_ingress() {
  local phase="$1" approval="${2:-yes}"
  (PUBLIC_BFT_PRODUCTION_INGRESS_APPROVED="$approval" run_dependencies "$phase")
}

run_ingress switch_ingress >/dev/null
test -s "$transaction/ingress/switch-result.json"
grep -Fq '"publicCutoverReady":true' "$transaction/ingress/switch-result.json"
grep -Fq 'public-bft-ingress' "$transaction/roles/primary-switch-ingress.txt"
run_ingress verify_public >/dev/null
test -s "$transaction/ingress/public-result.json"
grep -Fq '"publicIngressChanged":true' "$transaction/ingress/public-result.json"
grep -Fq 'https://rpc.ynxweb4.com' "$transaction/ingress/public-continuity/endpoints.txt"
if run_ingress switch_ingress no >/dev/null 2>&1; then
  echo "ingress switch unexpectedly passed without separate ingress approval" >&2
  exit 1
fi
run_ingress rollback_ingress >/dev/null
test -s "$transaction/ingress/rollback-result.json"
grep -Fq '"ingress":"authoritative"' "$transaction/ingress/rollback-result.json"
grep -Fq 'public-bft-ingress' "$transaction/roles/primary-rollback-ingress.txt"

if run_dependencies start_dependencies no >/dev/null 2>&1; then
  echo "dependency startup unexpectedly passed without separate dependency approval" >&2
  exit 1
fi
cp "$transaction/candidate/verify-result.json" "$tmp/verify-result.valid"
rm "$transaction/candidate/verify-result.json"
if run_dependencies start_dependencies yes >/dev/null 2>&1; then
  echo "dependency startup unexpectedly passed without verified candidate evidence" >&2
  exit 1
fi
mv "$tmp/verify-result.valid" "$transaction/candidate/verify-result.json"
run_dependencies rollback_dependencies >/dev/null
test -s "$transaction/dependencies/rollback-result.json"
grep -Fq 'automaticRollbackAuthorized' "$transaction/dependencies/rollback-result.json"
grep -Fq 'public-bft-dependencies' "$transaction/roles/primary-rollback-dependencies.txt"

if run_candidate deploy_candidate no >/dev/null 2>&1; then
  echo "candidate deploy unexpectedly passed without separate candidate approval" >&2
  exit 1
fi

cp "$transaction/candidate/package/package-manifest.json" "$tmp/package-manifest.valid"
printf '\n' >>"$transaction/candidate/package/package-manifest.json"
if run_candidate deploy_candidate >/dev/null 2>&1; then
  echo "candidate deploy unexpectedly accepted a tampered existing package" >&2
  exit 1
fi
mv "$tmp/package-manifest.valid" "$transaction/candidate/package/package-manifest.json"

cp "$transaction/final-snapshot/migration.json" "$tmp/migration.valid"
printf '\n' >>"$transaction/final-snapshot/migration.json"
if run_candidate deploy_candidate >/dev/null 2>&1; then
  echo "candidate deploy unexpectedly accepted a tampered final snapshot" >&2
  exit 1
fi
mv "$tmp/migration.valid" "$transaction/final-snapshot/migration.json"

cp "$tmp/validator-manifest.json" "$tmp/validator-manifest.valid"
printf '\n' >>"$tmp/validator-manifest.json"
if run_candidate deploy_candidate >/dev/null 2>&1; then
  echo "candidate deploy unexpectedly accepted an unapproved validator manifest checksum" >&2
  exit 1
fi
mv "$tmp/validator-manifest.valid" "$tmp/validator-manifest.json"

cp "$tmp/validator-manifest.json" "$tmp/validator-manifest.public"
cp "$transaction/approval.json" "$tmp/approval.public"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.privateKey="forbidden";fs.writeFileSync(p,JSON.stringify(v)+"\n")' "$tmp/validator-manifest.json"
private_manifest_sha="$(shasum -a 256 "$tmp/validator-manifest.json" | awk '{print $1}')"
node -e 'const fs=require("fs"),[p,s]=process.argv.slice(1),v=JSON.parse(fs.readFileSync(p));v.validatorManifestSha256=s;fs.writeFileSync(p,JSON.stringify(v)+"\n",{mode:0o600})' "$transaction/approval.json" "$private_manifest_sha"
if run_candidate deploy_candidate >/dev/null 2>&1; then
  echo "candidate deploy unexpectedly accepted private material in the public validator manifest" >&2
  exit 1
fi
mv "$tmp/validator-manifest.public" "$tmp/validator-manifest.json"
mv "$tmp/approval.public" "$transaction/approval.json"
chmod 0600 "$transaction/approval.json"

run_candidate rollback_candidate >/dev/null
test -s "$transaction/candidate/rollback-result.json"
grep -Fq '"automaticRollbackAuthorized":true' "$transaction/candidate/rollback-result.json"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$transaction/candidate/rollback.txt"
done
run_candidate rollback_candidate >/dev/null
test -s "$transaction/candidate/rollback-attempt-2.txt"

cp "$transaction/approval.json" "$tmp/approval.valid"
node -e 'const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v.automaticRollbackRequired=false;fs.writeFileSync(p,JSON.stringify(v)+"\n",{mode:0o600})' "$transaction/approval.json"
if run_candidate rollback_candidate >/dev/null 2>&1; then
  echo "candidate rollback unexpectedly passed without transaction automatic-rollback consent" >&2
  exit 1
fi
mv "$tmp/approval.valid" "$transaction/approval.json"
chmod 0600 "$transaction/approval.json"

echo "public-bft-production-candidate-check passed: candidate, dependencies, ingress switch/restore, and public continuity are transaction-bound, signer-file isolated, failure-tested, and dry-run verified"
