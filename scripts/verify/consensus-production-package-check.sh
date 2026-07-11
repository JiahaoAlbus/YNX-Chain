#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

go test ./internal/consensus -run 'Test(GenerateProductionCandidatePackageAndVerifyHostKeys|ProductionValidatorManifestRejectsUnsafeInputs|ProductionPackageRefusesExistingOutputAndUnhashedPrivateFile)' -count=1
go test ./cmd/ynx-consensus-package ./cmd/ynx-consensus-keycheck
bash -n scripts/deploy/deploy-consensus-candidate.sh scripts/ops/rollback-consensus-candidate.sh scripts/verify/verify-consensus-candidate.sh scripts/verify/consensus-candidate-fault-drill.sh scripts/verify/consensus-candidate-signed-tx-drill.sh

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
go run ./cmd/ynx-consensus-lab -ephemeral -local-fixture -output "$tmp/lab" >/dev/null
node scripts/verify/build-consensus-production-fixture.mjs "$tmp/lab/network-manifest.json" "$tmp/validator-manifest.json"
go run ./cmd/ynx-consensus-package \
  -migration-state "$tmp/lab/bound-migration.json" \
  -validator-manifest "$tmp/validator-manifest.json" \
  -genesis-time 2026-08-01T00:00:00Z \
  -output "$tmp/package" >/dev/null
go run ./cmd/ynx-consensus-package -verify-package "$tmp/package" >/dev/null
bash -n "$tmp"/package/roles/*/scripts/*.sh
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
DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_CANDIDATE_PACKAGE="$tmp/package" CONSENSUS_CANDIDATE_WORK_ROOT="$tmp/deploy-work" \
  bash scripts/deploy/deploy-consensus-candidate.sh >"$tmp/deploy.out"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$tmp/deploy.out" || { echo "candidate deploy dry-run missing role $role" >&2; exit 1; }
done
grep -Fq "public ingress and authoritative ynx-chaind remain unchanged" "$tmp/deploy.out" || { echo "candidate deploy dry-run lost public rollback boundary" >&2; exit 1; }

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_CANDIDATE_PACKAGE="$tmp/package" \
  bash scripts/verify/verify-consensus-candidate.sh >"$tmp/verify.out"
grep -Fq "no remote or public proof was generated" "$tmp/verify.out" || { echo "candidate verifier dry-run claim boundary missing" >&2; exit 1; }

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" CONSENSUS_CANDIDATE_PACKAGE="$tmp/package" \
  bash scripts/verify/consensus-candidate-fault-drill.sh >"$tmp/fault.out"
grep -Fq "no validator was stopped" "$tmp/fault.out" || { echo "candidate fault dry-run boundary missing" >&2; exit 1; }

DEPLOY_DRY_RUN=1 ENV_FILE="$tmp/deploy.env" bash scripts/ops/rollback-consensus-candidate.sh >"$tmp/rollback.out"
for role in primary singapore silicon-valley seoul; do
  grep -Fq "DRY RUN [$role]" "$tmp/rollback.out" || { echo "candidate rollback dry-run missing role $role" >&2; exit 1; }
done

for required in \
  'StrictHostKeyChecking=yes' \
  'CONSENSUS_CANDIDATE_APPROVED=yes' \
  'ynx-consensus-keycheck' \
  'backup-candidate.sh' \
  'install-candidate.sh' \
  'systemctl is-active ynx-chaind' \
  'public ingress and authoritative ynx-chaind remain unchanged'; do
  grep -Fq "$required" scripts/deploy/deploy-consensus-candidate.sh || { echo "candidate deploy path missing: $required" >&2; exit 1; }
done

unsafe_ssh_policy='StrictHostKeyChecking='
unsafe_ssh_policy+='accept-new'
for forbidden in 'systemctl stop ynx-chaind' 'systemctl restart ynx-chaind' "$unsafe_ssh_policy"; do
  if grep -Fq "$forbidden" scripts/deploy/deploy-consensus-candidate.sh scripts/ops/rollback-consensus-candidate.sh; then
    echo "candidate deployment path contains forbidden operation: $forbidden" >&2
    exit 1
  fi
done

echo "consensus-production-package-check passed: public-key-only package, host key matching, parallel services, strict SSH, backup, and rollback boundaries"
