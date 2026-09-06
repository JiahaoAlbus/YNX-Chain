#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: build-runtime.sh <source-commit> <output.tar.gz>" >&2
  exit 64
fi

source_commit=$1
output=$2
repo_root=$(git rev-parse --show-toplevel)

if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "source commit must be a lowercase 40-character SHA" >&2
  exit 65
fi
git cat-file -e "${source_commit}^{commit}"

tar_bin=""
for candidate in gtar tar; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" --help 2>&1 | grep -q -- '--sort'; then
    tar_bin=$candidate
    break
  fi
done
if [[ -z "$tar_bin" ]]; then
  echo "GNU tar with --sort is required" >&2
  exit 69
fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/ynx-video-runtime.XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/runtime/i18n" "$stage/runtime/ynx-dapp-connect-sdk" "$stage/runtime/runtime" "$stage/runtime/assets"

files=(
  app.js
  assets/ynx-logo.svg
  i18n.js
  i18n/catalog.json
  index.html
  package.json
  responsive.css
  runtime/post-p0239-recovery-baseline.json
  runtime/topology.json
  server.mjs
  styles.css
  wallet-connection.js
  ynx-dapp-connect-sdk/constants.js
  ynx-dapp-connect-sdk/discovery.js
  ynx-dapp-connect-sdk/errors.js
  ynx-dapp-connect-sdk/manifest.json
  ynx-dapp-connect-sdk/provider.js
)

# Preserve historical source builds; every v2 source must contain the complete
# callback/client bundle. No file is silently sourced from the working tree.
if git cat-file -e "${source_commit}:apps/video/product-session.js" 2>/dev/null; then
  files+=(product-session.js product-session-sdk.js product-session-registry.json product-session-sdk-source.json
    video-api.js watch-progress.js wallet-callback.js wallet-callback.html callback.css)
fi

for file in "${files[@]}"; do
  git show "${source_commit}:apps/video/${file}" > "$stage/runtime/$file"
done

SOURCE_COMMIT="$source_commit" STAGE_ROOT="$stage/runtime" node --input-type=module <<'NODE'
import {createHash} from "node:crypto";
import {readdir, readFile, stat, writeFile} from "node:fs/promises";
import {join, relative} from "node:path";

const root = process.env.STAGE_ROOT;
const walk = async (dir) => {
  const found = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) found.push(...await walk(path));
    else found.push(relative(root, path));
  }
  return found;
};
const hashes = {};
for (const file of await walk(root)) {
  const bytes = await readFile(join(root, file));
  hashes[file] = {bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
}
const manifest = {
  schemaVersion: "ynx-video-deployable-runtime/1",
  sourceCommit: process.env.SOURCE_COMMIT,
  entrypoint: "server.mjs",
  listen: {host: "127.0.0.1", portEnvironment: "PORT", productionPort: 6494},
  topology: "runtime/topology.json",
  dependencyModel: "node-standard-library-only",
  files: hashes
};
await writeFile(join(root, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

mkdir -p "$(dirname "$output")"
tmp_output="${output}.tmp.$$"
"$tar_bin" \
  --sort=name \
  --mtime='UTC 1970-01-01' \
  --owner=0 --group=0 --numeric-owner \
  --mode='u=rwX,go=rX' \
  --format=ustar \
  -C "$stage" -cf - runtime | gzip -9 -n > "$tmp_output"
mv "$tmp_output" "$output"

sha=$(shasum -a 256 "$output" | awk '{print $1}')
bytes=$(wc -c < "$output" | tr -d ' ')
printf '{"sourceCommit":"%s","path":"%s","bytes":%s,"sha256":"%s"}\n' "$source_commit" "$output" "$bytes" "$sha"
