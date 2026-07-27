#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
# shellcheck source=../deploy/lib.sh
source scripts/deploy/lib.sh

package_dir="${1:?usage: promote-public-release.sh <verified-package-dir> <new-output-dir>}"
output="${2:?missing promotion output directory}"
system_tmp="${TMPDIR:-/tmp}"
system_tmp="${system_tmp%/}"
case "$output" in
  tmp/*) output="$root/$output" ;;
  "$root"/tmp/* | "$system_tmp"/* | /tmp/* | /private/tmp/*) ;;
  *) echo "promotion output must be under repository tmp/ or the system temporary directory" >&2; exit 1 ;;
esac
[[ ! -e "$output" ]] || { echo "promotion output must not already exist" >&2; exit 1; }

required_env=(
  YNX_DATA_FABRIC_SECURE_SIGNER_COMMAND
  YNX_DATA_FABRIC_SIGNING_PUBLIC_KEY
  YNX_DATA_FABRIC_SIGNING_CLASS
  YNX_DATA_FABRIC_SIGNING_APPROVAL_ID
  YNX_DATA_FABRIC_PROVENANCE_IDENTITY
  YNX_DATA_FABRIC_RELEASE_APPROVER
  YNX_DATA_FABRIC_IMMUTABLE_UPLOAD_COMMAND
  YNX_DATA_FABRIC_IMMUTABLE_BASE_URL
  YNX_DATA_FABRIC_COLD_START_EVIDENCE_FILE
)
for name in "${required_env[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "$name is required" >&2; exit 1; }
done
if [[ "${YNX_DATA_FABRIC_PUBLIC_RELEASE_TEST_MODE:-0}" == "1" ]]; then
  node -e 'const u=new URL(process.argv[1]); if (u.protocol !== "https:" || (u.hostname !== "127.0.0.1" && u.hostname !== "::1")) process.exit(1)' \
    "$YNX_DATA_FABRIC_IMMUTABLE_BASE_URL" ||
    { echo "public release test mode is restricted to loopback HTTPS" >&2; exit 1; }
else
  [[ "${YNX_DATA_FABRIC_PUBLIC_RELEASE_APPROVED:-}" == "yes" ]] || { echo "YNX_DATA_FABRIC_PUBLIC_RELEASE_APPROVED=yes is required" >&2; exit 1; }
  ynx_require_clean_worktree
  jq -e '.environment == "linux-runtime" and .status == "verified"' "$YNX_DATA_FABRIC_COLD_START_EVIDENCE_FILE" >/dev/null ||
    { echo "production promotion requires verified Linux runtime cold-start evidence" >&2; exit 1; }
fi
signer_command="$YNX_DATA_FABRIC_SECURE_SIGNER_COMMAND"
public_key="$YNX_DATA_FABRIC_SIGNING_PUBLIC_KEY"
upload_command="$YNX_DATA_FABRIC_IMMUTABLE_UPLOAD_COMMAND"
cold_start_evidence="$YNX_DATA_FABRIC_COLD_START_EVIDENCE_FILE"
for executable in "$signer_command" "$upload_command"; do
  [[ "$executable" == /* && -x "$executable" && -f "$executable" ]] || { echo "signer and uploader commands must be absolute executable files" >&2; exit 1; }
done
[[ "$public_key" == /* && -r "$public_key" && -f "$public_key" ]] || { echo "signing public key must be an absolute readable file" >&2; exit 1; }
[[ "$cold_start_evidence" == /* && -r "$cold_start_evidence" && -f "$cold_start_evidence" ]] || { echo "cold-start evidence must be an absolute readable file" >&2; exit 1; }
if [[ -n "${YNX_DATA_FABRIC_PUBLIC_DOWNLOAD_CA_FILE:-}" ]]; then
  [[ "$YNX_DATA_FABRIC_PUBLIC_DOWNLOAD_CA_FILE" == /* && -r "$YNX_DATA_FABRIC_PUBLIC_DOWNLOAD_CA_FILE" ]] ||
    { echo "download CA file must be absolute and readable" >&2; exit 1; }
fi

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
node scripts/data-fabric/verify-public-testnet-release.mjs "$package_dir" "$commit" "$release" >/dev/null
stage="$package_dir/build/$release"
[[ -d "$stage" ]] || { echo "verified package build stage is missing" >&2; exit 1; }

publish_dir="$output/public"
hosting_receipt="$output/immutable-hosting-receipt.json"
mkdir -p "$publish_dir"
install -m 0644 "$package_dir/${release}-linux-amd64.tar.gz" "$publish_dir/${release}-linux-amd64.tar.gz"
install -m 0644 "$package_dir/${release}-release-index.json" "$publish_dir/${release}-release-index.json"
install -m 0644 "$stage/release-manifest.json" "$publish_dir/${release}-release-manifest.json"
install -m 0644 "$stage/provenance.json" "$publish_dir/${release}-provenance.json"
install -m 0644 "$stage/sbom/go-runtime.spdx.json" "$publish_dir/${release}-go-runtime.spdx.json"
install -m 0644 "$stage/scripts/install-testnet-release.sh" "$publish_dir/${release}-install-testnet-release.sh"
install -m 0644 "$cold_start_evidence" "$publish_dir/${release}-cold-start-evidence.json"
install -m 0644 "$public_key" "$publish_dir/${release}-public-release.pub.pem"

public_key_der="$output/public-key.der"
openssl pkey -pubin -in "$public_key" -outform DER -out "$public_key_der"
public_key_sha="$(sha256sum "$public_key_der" | awk '{print $1}')"
node scripts/data-fabric/write-public-release.mjs \
  "$publish_dir" "$commit" "$release" "$YNX_DATA_FABRIC_IMMUTABLE_BASE_URL" "$public_key_sha" \
  "$YNX_DATA_FABRIC_SIGNING_CLASS" "$YNX_DATA_FABRIC_SIGNING_APPROVAL_ID" \
  "$YNX_DATA_FABRIC_PROVENANCE_IDENTITY" "$YNX_DATA_FABRIC_RELEASE_APPROVER"

release_record="$publish_dir/${release}-public-release.json"
signature="$publish_dir/${release}-public-release.sig"
digest_file="$output/public-release.sha256.bin"
openssl dgst -sha256 -binary -out "$digest_file" "$release_record"
"$signer_command" sign --digest-file "$digest_file" --signature-output "$signature"
[[ -s "$signature" ]] || { echo "secure signer did not produce a detached signature" >&2; exit 1; }
openssl pkeyutl -verify -pubin -inkey "$public_key" -rawin -in "$digest_file" -sigfile "$signature" >/dev/null

"$upload_command" upload --source-dir "$publish_dir" --base-url "$YNX_DATA_FABRIC_IMMUTABLE_BASE_URL" --receipt-output "$hosting_receipt"
[[ -s "$hosting_receipt" ]] || { echo "immutable uploader did not produce a hosting receipt" >&2; exit 1; }
openssl pkeyutl -verify -pubin -inkey "$public_key" -rawin -in "$digest_file" -sigfile "$signature" >/dev/null

downloads="$output/downloads.tsv"
node scripts/data-fabric/verify-public-release.mjs \
  "$publish_dir" "$hosting_receipt" "$commit" "$release" "$YNX_DATA_FABRIC_IMMUTABLE_BASE_URL" --downloads >"$downloads"
curl_args=(--fail --silent --show-error --proto '=https' --tlsv1.2)
if [[ -n "${YNX_DATA_FABRIC_PUBLIC_DOWNLOAD_CA_FILE:-}" ]]; then
  curl_args+=(--cacert "$YNX_DATA_FABRIC_PUBLIC_DOWNLOAD_CA_FILE")
fi
while IFS=$'\t' read -r name url expected_bytes expected_sha; do
  downloaded="$output/downloaded-$name"
  curl "${curl_args[@]}" --output "$downloaded" "$url"
  [[ "$(wc -c < "$downloaded" | tr -d ' ')" == "$expected_bytes" ]] || { echo "hosted object byte count mismatch: $name" >&2; exit 1; }
  printf '%s  %s\n' "$expected_sha" "$downloaded" | sha256sum -c - >/dev/null
done <"$downloads"

node scripts/data-fabric/verify-public-release.mjs \
  "$publish_dir" "$hosting_receipt" "$commit" "$release" "$YNX_DATA_FABRIC_IMMUTABLE_BASE_URL"
printf 'public release promotion completed release=%s commit=%s hostedObjects=%s receipt=%s\n' \
  "$release" "$commit" "$(wc -l < "$downloads" | tr -d ' ')" "$hosting_receipt"
