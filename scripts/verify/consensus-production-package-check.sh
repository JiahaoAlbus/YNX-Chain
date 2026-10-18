#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# Reuse the deployer's actual bounded v2 parser without running its startup,
# creating its work directory, building binaries, or contacting a host.
# shellcheck source=../deploy/deploy-consensus-candidate.sh
source scripts/deploy/deploy-consensus-candidate.sh

consensus_production_runtime_inputs() {
  runtime_bundle="${CONSENSUS_CANDIDATE_RUNTIME_BUNDLE:-}"
  runtime_commit="${CONSENSUS_CANDIDATE_RUNTIME_COMMIT:-}"
  runtime_manifest_sha="${CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256:-}"
  [[ "$runtime_bundle" == /* && -d "$runtime_bundle" && ! -L "$runtime_bundle" ]] || { echo "CONSENSUS_CANDIDATE_RUNTIME_BUNDLE must reference the original absolute CI runtime directory" >&2; return 1; }
  [[ "$runtime_commit" =~ ^[0-9a-f]{40}$ && "$runtime_manifest_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "independent full runtime commit and exact SOURCE.json SHA256 are required" >&2; return 1; }
  [[ "$(git rev-parse HEAD)" == "$runtime_commit" ]] || { echo "package check source must equal the independently pinned runtime commit" >&2; return 1; }
  validate_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" || return $?
}

consensus_production_prepare_runtime() {
  # Artifact extraction may set every file to 0644. Use the deployer's actual
  # exclusive-copy/reverify helper; never chmod or execute the original bundle.
  prepare_runtime_bundle "$runtime_bundle" "$runtime_commit" "$runtime_manifest_sha" "$1" || return $?
  package_verifier="$1/ynx-consensus-package"
  [[ -x "$package_verifier" ]] || { echo "verified retained package verifier is not executable" >&2; return 1; }
}

consensus_production_deploy_dry_run() {
  DEPLOY_DRY_RUN=1 ENV_FILE="$1" CONSENSUS_CANDIDATE_PACKAGE="$2" CONSENSUS_CANDIDATE_WORK_ROOT="$3" \
    CONSENSUS_CANDIDATE_RUNTIME_BUNDLE="$runtime_bundle" \
    CONSENSUS_CANDIDATE_RUNTIME_COMMIT="$runtime_commit" \
    CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256="$runtime_manifest_sha" \
    bash scripts/deploy/deploy-consensus-candidate.sh
}

# Missing/mismatched pins fail before tests, fixtures, keys or staging writes.
consensus_production_runtime_inputs

go test ./internal/consensus -run 'Test(GenerateProductionCandidatePackageAndVerifyHostKeys|ProductionValidatorManifestRejectsUnsafeInputs|ProductionPackageRefusesExistingOutputAndUnhashedPrivateFile)' -count=1
go test ./cmd/ynx-consensus-package ./cmd/ynx-consensus-keycheck ./cmd/ynx-consensus-key-init
bash -n scripts/deploy/deploy-consensus-candidate.sh scripts/deploy/deploy-consensus-overlay.sh scripts/ops/init-consensus-candidate-keys.sh scripts/ops/init-consensus-overlay-keys.sh scripts/ops/rollback-consensus-candidate.sh scripts/verify/consensus-candidate-deploy-gate.sh scripts/verify/verify-consensus-candidate.sh scripts/verify/verify-consensus-overlay.sh scripts/verify/consensus-candidate-fault-drill.sh scripts/verify/consensus-candidate-signed-tx-drill.sh

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
consensus_production_prepare_runtime "$tmp/runtime"
go run ./cmd/ynx-consensus-lab -ephemeral -local-fixture -output "$tmp/lab" >/dev/null
node scripts/verify/build-consensus-production-fixture.mjs "$tmp/lab/network-manifest.json" "$tmp/validator-manifest.json"
"$package_verifier" \
  -migration-state "$tmp/lab/bound-migration.json" \
  -validator-manifest "$tmp/validator-manifest.json" \
  -genesis-time 2026-08-01T00:00:00Z \
  -output "$tmp/package" >/dev/null
"$package_verifier" -verify-package "$tmp/package" >/dev/null
bash -n "$tmp"/package/roles/*/scripts/*.sh
for role in primary singapore silicon-valley seoul; do
  grep -Fq '/var/lib/ynx-chain/consensus-candidate/bin/ynx-abci' "$tmp/package/roles/$role/systemd/ynx-consensus-abci-candidate.service"
  grep -Fq '/var/lib/ynx-chain/consensus-candidate/bin/cometbft' "$tmp/package/roles/$role/systemd/ynx-consensus-comet-candidate.service"
  grep -Fq 'install -m 0755 -o root -g root "$binary_dir/ynx-abci" /var/lib/ynx-chain/consensus-candidate/bin/ynx-abci' "$tmp/package/roles/$role/scripts/install-candidate.sh"
  if grep -Eq '/usr/local/bin/(ynx-abci|ynx-consensus-keycheck|cometbft)' "$tmp/package/roles/$role/systemd/"* "$tmp/package/roles/$role/scripts/install-candidate.sh"; then
    echo "candidate package unexpectedly overwrites global binaries for $role" >&2
    exit 1
  fi
done
node scripts/verify/consensus-candidate-evidence.mjs --self-test "$tmp/package"
node scripts/verify/consensus-candidate-tx-evidence.mjs --self-test

key="$tmp/deploy-key"
: > "$key"
chmod 0600 "$key"
cat > "$tmp/deploy.env" <<EOF
PRIMARY_NODE_HOST=127.0.0.1
PRIMARY_NODE_USER=ynx
PRIMARY_NODE_SSH_KEY=$key
SG_NODE_HOST=127.0.0.2
SG_NODE_USER=root
SG_NODE_SSH_KEY=$key
SILICON_VALLEY_NODE_HOST=127.0.0.3
SILICON_VALLEY_NODE_USER=ubuntu
SILICON_VALLEY_NODE_SSH_KEY=$key
SEOUL_NODE_HOST=127.0.0.4
SEOUL_NODE_USER=root
SEOUL_NODE_SSH_KEY=$key
EOF
DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_CANDIDATE_KEY_WORK_ROOT="$tmp/key-work" \
  bash scripts/ops/init-consensus-candidate-keys.sh >"$tmp/key-ceremony.out"
grep -Fq "no keys were generated" "$tmp/key-ceremony.out" || { echo "candidate key ceremony dry-run boundary missing" >&2; exit 1; }

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_OVERLAY_KEY_WORK_ROOT="$tmp/overlay-key-work" \
  bash scripts/ops/init-consensus-overlay-keys.sh >"$tmp/overlay-key-ceremony.out"
grep -Fq "no packages or keys were installed" "$tmp/overlay-key-ceremony.out" || { echo "overlay key ceremony dry-run boundary missing" >&2; exit 1; }

mkdir -p "$tmp/overlay-records"
node - "$tmp/overlay-records" <<'NODE'
const fs = require("fs"), path = require("path"), root = process.argv[2];
const roles = ["primary", "singapore", "silicon-valley", "seoul"];
roles.forEach((role, index) => fs.writeFileSync(path.join(root, `${role}.json`), JSON.stringify({version:1,purpose:"ynx-consensus-private-overlay-public-keys-only",role,publicEndpoint:`198.51.100.${index+1}`,overlayAddress:`10.77.42.${index+1}`,listenPort:51820,wireGuardPublicKey:Buffer.alloc(32,index+1).toString("base64"),custodyBoundary:"owner-controlled-host-local"},null,2)+"\n",{mode:0o600}));
NODE
node scripts/deploy/build-consensus-overlay-package.mjs "$tmp/overlay-records" "$tmp/overlay-package" >/dev/null
bash -n "$tmp"/overlay-package/roles/*/ynx-consensus-overlay-up
DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_OVERLAY_PUBLIC_RECORDS="$tmp/overlay-records" CONSENSUS_OVERLAY_WORK_ROOT="$tmp/overlay-work" \
  bash scripts/deploy/deploy-consensus-overlay.sh >"$tmp/overlay-deploy.out"
grep -Fq "no interface was created and no reachability is claimed" "$tmp/overlay-deploy.out" || { echo "overlay deploy dry-run boundary missing" >&2; exit 1; }

mkdir -p "$tmp/validator-records"
node - "$tmp/validator-manifest.json" "$tmp/validator-records" <<'NODE'
const fs=require("fs"),path=require("path"),[input,output]=process.argv.slice(2),manifest=JSON.parse(fs.readFileSync(input));
for(const validator of manifest.validators) fs.writeFileSync(path.join(output,`${validator.role}.json`),JSON.stringify({version:1,purpose:manifest.purpose,role:validator.role,validatorAddress:validator.validatorAddress,consensusKeyType:validator.consensusKeyType,consensusPubKey:validator.consensusPubKey,consensusAddress:validator.consensusAddress,nodeId:validator.nodeId,custodyBoundary:"owner-controlled-host-local"},null,2)+"\n",{mode:0o600});
NODE
node scripts/ops/build-production-validator-manifest.mjs "$tmp/validator-records" "$tmp/overlay-records" "$tmp/merged-validator-manifest.json" >/dev/null
"$package_verifier" -migration-state "$tmp/lab/bound-migration.json" -validator-manifest "$tmp/merged-validator-manifest.json" -genesis-time 2026-08-02T00:00:00Z -output "$tmp/merged-package" >/dev/null
"$package_verifier" -verify-migration-state "$tmp/lab/bound-migration.json" >/dev/null

consensus_production_deploy_dry_run "$tmp/deploy.env" "$tmp/package" "$tmp/deploy-work" >"$tmp/deploy.out"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$tmp/deploy.out" || { echo "candidate deploy dry-run missing role $role" >&2; exit 1; }
done
grep -Fq "public ingress and authoritative ynx-chaind remain unchanged" "$tmp/deploy.out" || { echo "candidate deploy dry-run lost public rollback boundary" >&2; exit 1; }
grep -Fq '/var/lib/ynx-chain/consensus-candidate/bin/' "$tmp/deploy.out" || { echo "candidate deploy does not install primary dependencies under the bounded candidate root" >&2; exit 1; }
runtime_copy="$tmp/deploy-work/ynx-consensus-candidate-${runtime_commit:0:12}/runtime"
validate_runtime_bundle "$runtime_copy" "$runtime_commit" "$runtime_manifest_sha"
for binary in ynx-abci ynx-comet ynx-bft-gatewayd ynx-consensus-pq-remote-signer ynx-consensus-pq-key-init ynx-consensus-proof-verify ynx-consensus-package ynx-consensus-keycheck; do
  cmp "$runtime_bundle/$binary" "$runtime_copy/$binary" || { echo "candidate deploy replaced the original pinned runtime binary: $binary" >&2; exit 1; }
done
cmp "$runtime_bundle/SOURCE.json" "$runtime_copy/SOURCE.json"
for role in primary singapore silicon-valley seoul; do
  stage="$tmp/deploy-work/ynx-consensus-candidate-${runtime_commit:0:12}/roles/$role"
  cmp "$runtime_bundle/ynx-abci" "$stage/bin/ynx-abci"
  cmp "$runtime_bundle/ynx-comet" "$stage/bin/cometbft"
  cmp "$runtime_bundle/ynx-consensus-keycheck" "$stage/bin/ynx-consensus-keycheck"
  cmp "$runtime_bundle/SOURCE.json" "$stage/runtime-SOURCE.json"
  if [[ "$role" == primary ]]; then
    cmp "$runtime_bundle/ynx-bft-gatewayd" "$stage/bin/ynx-bft-gatewayd"
  fi
  for excluded in ynx-ai-gatewayd ynx-payd ynx-trustd ynx-indexerd ynx-explorerd ynx-faucetd ynx-resourced; do
    [[ ! -e "$stage/bin/$excluded" && ! -L "$stage/bin/$excluded" ]] || { echo "candidate stage contains a service outside the fixed runtime profile: $excluded" >&2; exit 1; }
  done
done
if grep -Eq '/usr/local/bin/(ynx-abci|cometbft|ynx-consensus-keycheck|ynx-bft-gatewayd|ynx-indexerd|ynx-explorerd|ynx-faucetd|ynx-ai-gatewayd|ynx-payd|ynx-trustd|ynx-resourced)' "$tmp/deploy.out"; then
  echo "candidate deploy unexpectedly overwrites a global dependency binary" >&2
  exit 1
fi

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_CANDIDATE_PACKAGE="$tmp/package" CONSENSUS_CANDIDATE_EVIDENCE_DIR="$tmp/evidence" \
  CONSENSUS_CANDIDATE_RUNTIME_BUNDLE="$runtime_bundle" CONSENSUS_CANDIDATE_RUNTIME_COMMIT="$runtime_commit" CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256="$runtime_manifest_sha" \
  bash scripts/verify/verify-consensus-candidate.sh >"$tmp/verify.out"
grep -Fq "no remote or public proof was generated" "$tmp/verify.out" || { echo "candidate verifier dry-run claim boundary missing" >&2; exit 1; }

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_CANDIDATE_PACKAGE="$tmp/package" \
  bash scripts/verify/consensus-candidate-fault-drill.sh >"$tmp/fault.out"
grep -Fq "no validator was stopped" "$tmp/fault.out" || { echo "candidate fault dry-run boundary missing" >&2; exit 1; }

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" bash scripts/ops/rollback-consensus-candidate.sh >"$tmp/rollback.out"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role] UNSAFE_AUTOMATIC_CANDIDATE_ROLLBACK_REFUSED:" "$tmp/rollback.out" || { echo "candidate rollback dry-run missing preservation refusal for role $role" >&2; exit 1; }
done
grep -Fq 'no transport or rollback performed' "$tmp/rollback.out" || { echo "candidate rollback dry-run lost its no-mutation boundary" >&2; exit 1; }

for required in \
  'CONSENSUS_CANDIDATE_APPROVED=yes' \
  'ynx-consensus-keycheck' \
  'backup-candidate.sh' \
  'install-candidate.sh' \
  'systemctl is-active ynx-chaind' \
  'public ingress and authoritative ynx-chaind remain unchanged'; do
  grep -Fq "$required" scripts/deploy/deploy-consensus-candidate.sh || { echo "candidate deploy path missing: $required" >&2; exit 1; }
done
grep -Fq 'ynx_transport_ssh' scripts/ops/lib.sh || { echo "candidate ops helper does not use shared SSH transport" >&2; exit 1; }
grep -Fq 'StrictHostKeyChecking=yes' scripts/deploy/lib.sh || { echo "shared strict SSH transport is missing host-key enforcement" >&2; exit 1; }
grep -Fq 'ControlMaster=auto' scripts/deploy/lib.sh || { echo "shared SSH transport is missing bounded multiplexing" >&2; exit 1; }
grep -Fq 'chmod 0600 "$tarball"' scripts/deploy/deploy-testnet.sh || { echo "release bundle is not mode restricted before transport" >&2; exit 1; }
grep -Fq "stat -c '%a'" scripts/deploy/deploy-testnet.sh || { echo "remote release bundle mode is not verified" >&2; exit 1; }
grep -Fq 'sha256sum -c -' scripts/deploy/deploy-testnet.sh || { echo "remote release bundle checksum is not verified" >&2; exit 1; }
grep -Fq 'YNX_BLOCK_PRODUCTION_PAUSE_FILE=/var/lib/ynx-chain/block-production-pause.json' scripts/deploy/deploy-testnet.sh || { echo "authoritative production pause marker is not deployed" >&2; exit 1; }
grep -Fq 'StartWithPause' cmd/ynx-chaind/main.go || { echo "authoritative runtime does not preserve reads during bounded production pause" >&2; exit 1; }
grep -Fq 'public-bft-authoritative-pause.sh' scripts/ops/public-bft-production-driver.sh || { echo "production driver does not implement authoritative pause/resume" >&2; exit 1; }
grep -Fq 'public-bft-final-snapshot.sh' scripts/ops/public-bft-production-driver.sh || { echo "production driver does not implement final snapshot export" >&2; exit 1; }

unsafe_ssh_policy='StrictHostKeyChecking='
unsafe_ssh_policy+='accept-new'
for forbidden in 'systemctl stop ynx-chaind' 'systemctl restart ynx-chaind' "$unsafe_ssh_policy"; do
  if grep -Fq "$forbidden" scripts/deploy/deploy-consensus-candidate.sh scripts/ops/rollback-consensus-candidate.sh; then
    echo "candidate deployment path contains forbidden operation: $forbidden" >&2
    exit 1
  fi
done

echo "consensus-production-package-check passed: pinned v2 runtime bytes, public-key-only package, host key matching, parallel services, strict SSH, backup, and rollback boundaries; no deployment or activation performed"
