#!/usr/bin/env bash
set -euo pipefail

output_dir=${1:?usage: build-aligned-runtime-candidate.sh OUTPUT_DIR}
repo_root=$(git rev-parse --show-toplevel)
source_commit=$(git -C "$repo_root" rev-parse HEAD)
short_commit=${source_commit:0:12}
release_name="ynx-finance-${short_commit}"
stage_root=$(mktemp -d "${TMPDIR:-/tmp}/ynx-finance-aligned.XXXXXX")
stage="$stage_root/$release_name"

cleanup() { rm -rf "$stage_root"; }
trap cleanup EXIT

mkdir -p "$stage/web" "$output_dir"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "$stage/ynx-finance" "$repo_root/apps/finance/cmd/server"

assets=(index.html app.js read-sources.js styles.css manifest.webmanifest ynx-logo.png wallet-auth.js)
for asset in "${assets[@]}"; do
  install -m 0644 "$repo_root/apps/finance/web/$asset" "$stage/web/$asset"
done

printf '{"schemaVersion":1,"product":"finance","classification":"local-unsigned-aligned-runtime-candidate","sourceCommit":"%s","publicFrontendSourceCommit":"75f0299aaf53263e4279acf93e9a06db9d055e38","backendSourceCommit":"7824af677dd052d20321431381523ab302614d98","deployedPublic":false,"productionSigned":false}\n' "$source_commit" > "$stage/release-identity.json"
(
  cd "$stage"
  for path in ynx-finance release-identity.json web/index.html web/app.js web/read-sources.js web/styles.css web/manifest.webmanifest web/ynx-logo.png web/wallet-auth.js; do
    printf '%s\t%s\t%s\n' "$(wc -c < "$path" | tr -d ' ')" "$(sha256sum "$path" | awk '{print $1}')" "$path"
  done > INVENTORY.tsv
)

GZIP=-n gtar --sort=name --mtime='UTC 2026-08-31' --owner=0 --group=0 --numeric-owner -C "$stage_root" -czf "$output_dir/$release_name-runtime.tar.gz" "$release_name"
printf '%s\n' "$output_dir/$release_name-runtime.tar.gz"
