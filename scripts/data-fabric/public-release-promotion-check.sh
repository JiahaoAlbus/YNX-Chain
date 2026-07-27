#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
work="$(mktemp -d)"
server_pids=()
cleanup() {
  set +u
  for pid in "${server_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
package_dir="$work/package"
scripts/data-fabric/package-public-testnet-release.sh "$package_dir" >/dev/null
archive_sha="$(jq -er '.artifact.sha256' "$package_dir/${release}-release-index.json")"
cold_start="$work/cold-start-evidence.json"
if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  bash scripts/data-fabric/generate-cold-start-evidence.sh "$package_dir" "$cold_start" >/dev/null
else
  jq -n \
    --arg commit "$commit" --arg release "$release" --arg archiveSha256 "$archive_sha" \
    '{
      schema:"ynx-data-fabric-cold-start-evidence/v1",
      commit:$commit,
      release:$release,
      target:{os:"linux",architecture:"amd64"},
      environment:"contract-test",
      status:"verified",
      archiveSha256:$archiveSha256,
      verificationScope:"promotion-contract-test",
      checks:{
        archiveIntegrity:true,
        extractedManifestIntegrity:true,
        executableELFInventory:true,
        daemonHealth:true,
        runtimeIdentity:true,
        metrics:true,
        operatorSurface:true,
        unauthorizedWriteRejected:true,
        fileIntegrityAudit:true,
        backupRestore:true,
        workerProcessLoad:true,
        payBridgeProcessLoad:true
      }
    }' >"$cold_start"
fi

signing_key="$work/signing-key.pem"
public_key="$work/signing-public.pem"
case "${YNX_DATA_FABRIC_TEST_SIGNING_ALGORITHM:-auto}" in
  auto)
    if openssl genpkey -algorithm ED25519 -out "$signing_key" >/dev/null 2>&1; then
      signing_algorithm="ed25519-over-sha256"
    else
      signing_algorithm="rsa-pkcs1-sha256-over-sha256"
      openssl genrsa -out "$signing_key" 3072 >/dev/null 2>&1
    fi
    ;;
  ed25519)
    signing_algorithm="ed25519-over-sha256"
    openssl genpkey -algorithm ED25519 -out "$signing_key" >/dev/null 2>&1
    ;;
  rsa)
    signing_algorithm="rsa-pkcs1-sha256-over-sha256"
    openssl genrsa -out "$signing_key" 3072 >/dev/null 2>&1
    ;;
  *)
    echo "unsupported test signing algorithm override" >&2
    exit 1
    ;;
esac
openssl pkey -in "$signing_key" -pubout -out "$public_key"
server_key="$work/server-key.pem"
server_certificate="$work/server-certificate.pem"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$server_key" -out "$server_certificate" -days 1 \
  -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" >/dev/null 2>&1

start_server() {
  local web_root="$1" ready="$2"
  mkdir -p "$web_root"
  node scripts/data-fabric/testdata/https-artifact-server.mjs "$web_root" "$server_certificate" "$server_key" "$ready" &
  server_pids+=("$!")
  for _attempt in $(seq 1 50); do [[ -s "$ready" ]] && break; sleep 0.1; done
  [[ -s "$ready" ]] || { echo "HTTPS artifact fixture did not start" >&2; exit 1; }
}

run_promotion() {
  local base_url="$1" web_root="$2" output="$3"
  YNX_DATA_FABRIC_PUBLIC_RELEASE_TEST_MODE="${YNX_DATA_FABRIC_PUBLIC_RELEASE_TEST_MODE_OVERRIDE:-1}" \
  YNX_DATA_FABRIC_SECURE_SIGNER_COMMAND="$root/scripts/data-fabric/testdata/secure-signer-fixture.sh" \
  YNX_DATA_FABRIC_SIGNING_PUBLIC_KEY="$public_key" \
  YNX_DATA_FABRIC_SIGNING_ALGORITHM="$signing_algorithm" \
  YNX_DATA_FABRIC_SIGNING_CLASS="test-hardware-backed-equivalent" \
  YNX_DATA_FABRIC_SIGNING_APPROVAL_ID="approval.public-release.test.0001" \
  YNX_DATA_FABRIC_PROVENANCE_IDENTITY="fixture://public-release-signer" \
  YNX_DATA_FABRIC_RELEASE_APPROVER="release-approver-test" \
  YNX_DATA_FABRIC_IMMUTABLE_UPLOAD_COMMAND="$root/scripts/data-fabric/testdata/immutable-uploader-fixture.mjs" \
  YNX_DATA_FABRIC_IMMUTABLE_BASE_URL="$base_url" \
  YNX_DATA_FABRIC_COLD_START_EVIDENCE_FILE="${YNX_DATA_FABRIC_COLD_START_EVIDENCE_OVERRIDE:-$cold_start}" \
  YNX_DATA_FABRIC_PUBLIC_DOWNLOAD_CA_FILE="$server_certificate" \
  YNX_DATA_FABRIC_FIXTURE_SIGNING_KEY="$signing_key" \
  YNX_DATA_FABRIC_FIXTURE_WEB_ROOT="$web_root" \
  scripts/data-fabric/promote-public-release.sh "$package_dir" "$output"
}

web_root="$work/web-success"
ready="$work/ready-success.json"
start_server "$web_root" "$ready"
base_url="https://127.0.0.1:$(jq -er '.port' "$ready")/releases/$release"
success="$(run_promotion "$base_url" "$web_root" "$work/success")"
grep -F "public release promotion completed release=$release commit=$commit" <<<"$success" >/dev/null

if YNX_DATA_FABRIC_PUBLIC_RELEASE_TEST_MODE_OVERRIDE=0 run_promotion "$base_url" "$web_root" "$work/unapproved" >/dev/null 2>&1; then
  echo "public release promotion accepted a production promotion without approval" >&2
  exit 1
fi

invalid_evidence="$work/invalid-cold-start.json"
jq '.checks.daemonHealth = false' "$cold_start" >"$invalid_evidence"
evidence_web_root="$work/web-invalid-evidence"
evidence_ready="$work/ready-invalid-evidence.json"
start_server "$evidence_web_root" "$evidence_ready"
evidence_base_url="https://127.0.0.1:$(jq -er '.port' "$evidence_ready")/releases/$release"
if YNX_DATA_FABRIC_COLD_START_EVIDENCE_OVERRIDE="$invalid_evidence" run_promotion "$evidence_base_url" "$evidence_web_root" "$work/invalid-evidence" >/dev/null 2>&1; then
  echo "public release promotion accepted invalid cold-start evidence" >&2
  exit 1
fi

if YNX_DATA_FABRIC_FIXTURE_INVALID_SIGNATURE=1 run_promotion "$base_url" "$web_root" "$work/invalid-signature" >/dev/null 2>&1; then
  echo "public release promotion accepted an invalid signer response" >&2
  exit 1
fi

tampered_web_root="$work/web-modified"
tampered_ready="$work/ready-modified.json"
start_server "$tampered_web_root" "$tampered_ready"
tampered_base_url="https://127.0.0.1:$(jq -er '.port' "$tampered_ready")/releases/$release"
if YNX_DATA_FABRIC_FIXTURE_TAMPER_HOSTED=1 run_promotion "$tampered_base_url" "$tampered_web_root" "$work/modified-hosting" >/dev/null 2>&1; then
  echo "public release promotion accepted a modified hosted object" >&2
  exit 1
fi

extra_web_root="$work/web-extra"
extra_ready="$work/ready-extra.json"
start_server "$extra_web_root" "$extra_ready"
extra_base_url="https://127.0.0.1:$(jq -er '.port' "$extra_ready")/releases/$release"
if YNX_DATA_FABRIC_FIXTURE_ADD_SOURCE_OBJECT=1 run_promotion "$extra_base_url" "$extra_web_root" "$work/extra-object" >/dev/null 2>&1; then
  echo "public release promotion accepted an unexpected source object" >&2
  exit 1
fi

printf '{"status":"verified","commit":"%s","release":"%s","boundaries":["approval","cold-start-evidence","signature","hosting-receipt","https-backread","object-inventory"]}\n' "$commit" "$release"
