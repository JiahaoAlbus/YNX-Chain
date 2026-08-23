#!/usr/bin/env bash
set -euo pipefail

predecessor_commit="e5ce33550bbd8a4be09a55a6bb3dd73cd3cb8833"
output=${1:-}
[[ -n "$output" ]] || { echo "usage: build-predecessor-runtime.sh OUTPUT.tar.gz" >&2; exit 64; }

repo_root=$(git rev-parse --show-toplevel)
[[ "$(git -C "$repo_root" cat-file -t "$predecessor_commit")" == "commit" ]] || { echo "predecessor commit unavailable" >&2; exit 65; }

stage=$(mktemp -d)
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT
runtime="$stage/runtime"
mkdir -p "$runtime/ynx-dapp-connect-sdk"

assets=(
  index.html
  app.js
  styles.css
  responsive.css
  i18n.js
  wallet-connection.js
  server.mjs
  ynx-dapp-connect-sdk/constants.js
  ynx-dapp-connect-sdk/discovery.js
  ynx-dapp-connect-sdk/errors.js
  ynx-dapp-connect-sdk/manifest.json
  ynx-dapp-connect-sdk/provider.js
)
for asset in "${assets[@]}"; do
  git -C "$repo_root" show "${predecessor_commit}:apps/video/$asset" > "$runtime/$asset"
done

PREDECESSOR_RUNTIME="$runtime" PREDECESSOR_COMMIT="$predecessor_commit" node <<'NODE'
const {createHash} = require("node:crypto");
const {readdirSync, readFileSync, statSync, writeFileSync} = require("node:fs");
const {join, relative} = require("node:path");
const root = process.env.PREDECESSOR_RUNTIME;
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else {
      const data = readFileSync(path);
      files.push({path: relative(root, path), bytes: data.length, sha256: createHash("sha256").update(data).digest("hex")});
    }
  }
}
walk(root);
const manifest = {
  schemaVersion: "ynx-video-predecessor-runtime/1",
  sourceCommit: process.env.PREDECESSOR_COMMIT,
  publicRoute: "https://web4.ynxweb4.com/video/",
  viewerPort: 6494,
  purpose: "exact rollback predecessor for the first dedicated Viewer bootstrap",
  files
};
writeFileSync(join(root, "predecessor-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

find "$runtime" -type f -exec chmod 0644 {} +
chmod 0755 "$runtime/server.mjs"
tar_bin=$(command -v gtar || command -v tar)
"$tar_bin" --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  --format=ustar -C "$stage" -cf - runtime | gzip -n > "$output"
