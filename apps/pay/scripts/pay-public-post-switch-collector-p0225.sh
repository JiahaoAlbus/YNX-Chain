#!/usr/bin/env bash
set -euo pipefail

readonly PAY_ORIGIN="https://pay.ynxweb4.com"
readonly PAY_HOST="43.153.202.237"
readonly PAY_USER="ubuntu"
readonly PAY_IDENTITY_FILE="/Users/huangjiahao/Downloads/Huang.pem"
readonly PAY_CANDIDATE_TAR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/release/pay/ynx-pay-web-5f4ce98e-static.tar.gz"
readonly PAY_CANDIDATE_SHA256="ae552951d8e569f04aced60db69e3c11422910cc1098a6e7061b0e84005ad09e"
readonly PAY_SOURCE_COMMIT="5f4ce98eb458550b976c17e3bc6d77cce4081a59"
readonly PAY_SOURCE_TREE="8f0c25c4d86eb22a564f3c7aeff9db6709a9b9f0"
readonly PAY_CADDY_SHA256="b606d1bdced436a984aed19981788f1a9471b4ccb7ad7f2c49b32015b729afa7"

fixture_root=""
if [[ "${1:-}" == "--fixture" ]]; then
  fixture_root="${2:?fixture dist root required}"
  output_dir="${3:?output directory required}"
else
  output_dir="${1:?output directory required}"
fi

if [[ -e "$output_dir" ]]; then
  echo "output directory must not exist: $output_dir" >&2
  exit 64
fi
mkdir -m 0700 "$output_dir"

candidate_root=""
cleanup() {
  if [[ -n "$candidate_root" && -d "$candidate_root" ]]; then
    rm -rf "$candidate_root"
  fi
}
trap cleanup EXIT

if [[ -n "$fixture_root" ]]; then
  candidate_dist="$fixture_root"
else
  actual_tar_sha="$(shasum -a 256 "$PAY_CANDIDATE_TAR" | awk '{print $1}')"
  [[ "$actual_tar_sha" == "$PAY_CANDIDATE_SHA256" ]] || {
    echo "candidate tar SHA mismatch" >&2
    exit 65
  }
  candidate_root="$(mktemp -d /tmp/ynx-pay-post-switch-candidate.XXXXXX)"
  tar -xzf "$PAY_CANDIDATE_TAR" -C "$candidate_root"
  candidate_dist="$candidate_root/dist"
fi

manifest_file="$candidate_dist/release-manifest.json"
[[ -f "$manifest_file" ]] || { echo "release manifest missing" >&2; exit 66; }

node - "$manifest_file" "$output_dir/resource-list.txt" <<'NODE'
const fs = require("fs");
const [manifestFile, outputFile] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const resources = ["index.html", "build-identity.json", "metadata.json", "release-manifest.json"];
for (const entry of manifest.files) resources.push(entry.path);
fs.writeFileSync(outputFile, [...new Set(resources)].join("\n") + "\n");
NODE

fetch_resource() {
  local resource_path="$1"
  local safe_name="${resource_path//\//_}"
  if [[ -n "$fixture_root" ]]; then
    cp "$candidate_dist/$resource_path" "$output_dir/$safe_name.body"
    {
      printf 'HTTP/2 200\n'
      if [[ "$resource_path" == "build-identity.json" ]]; then
        printf 'content-type: application/json\ncache-control: no-store, max-age=0, must-revalidate\n'
      else
        printf 'content-type: application/octet-stream\n'
      fi
    } >"$output_dir/$safe_name.headers"
    printf '200\n' >"$output_dir/$safe_name.status"
  else
    curl --silent --show-error --location --max-time 20 \
      --dump-header "$output_dir/$safe_name.headers" \
      --output "$output_dir/$safe_name.body" \
      --write-out '%{http_code}\n' \
      "$PAY_ORIGIN/$resource_path" >"$output_dir/$safe_name.status"
  fi
}

while IFS= read -r resource_path; do
  [[ -n "$resource_path" ]] || continue
  fetch_resource "$resource_path"
done <"$output_dir/resource-list.txt"

node - "$candidate_dist" "$output_dir" "$PAY_SOURCE_COMMIT" "$PAY_SOURCE_TREE" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const [dist, output, sourceCommit, sourceTree] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(dist, "release-manifest.json"), "utf8"));
const resources = new Map(manifest.files.map((entry) => [entry.path, entry]));
for (const resourcePath of ["index.html", "build-identity.json", "metadata.json", "release-manifest.json"]) {
  if (!resources.has(resourcePath)) {
    const bytes = fs.readFileSync(path.join(dist, resourcePath));
    resources.set(resourcePath, {
      path: resourcePath,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    });
  }
}
const summary = [];
for (const [resourcePath, expected] of resources) {
  const safeName = resourcePath.replaceAll("/", "_");
  const status = fs.readFileSync(path.join(output, `${safeName}.status`), "utf8").trim();
  const body = fs.readFileSync(path.join(output, `${safeName}.body`));
  const sha256 = crypto.createHash("sha256").update(body).digest("hex");
  if (status !== "200" || body.length !== expected.bytes || sha256 !== expected.sha256) {
    throw new Error(`${resourcePath}: status/bytes/SHA mismatch`);
  }
  summary.push({ path: resourcePath, status: 200, bytes: body.length, sha256 });
}
const identity = JSON.parse(fs.readFileSync(path.join(output, "build-identity.json.body"), "utf8"));
if (identity.sourceCommit !== sourceCommit || identity.sourceTree !== sourceTree) {
  throw new Error("build identity source mismatch");
}
const identityHeaders = fs.readFileSync(path.join(output, "build-identity.json.headers"), "utf8").toLowerCase();
if (!identityHeaders.includes("content-type: application/json") || !identityHeaders.includes("cache-control: no-store")) {
  throw new Error("build identity headers mismatch");
}
fs.writeFileSync(path.join(output, "resource-summary.json"), JSON.stringify({ sourceCommit, sourceTree, resources: summary }, null, 2) + "\n");
NODE

if [[ -n "$fixture_root" ]]; then
  cat >"$output_dir/remote-runtime.txt" <<EOF
$PAY_CADDY_SHA256  /etc/caddy/ynx-chain.caddy
ActiveState=active
SubState=running
NRestarts=0
LISTEN 127.0.0.1:6430
LISTEN 127.0.0.1:6484
EOF
  cat >"$output_dir/health.body" <<'EOF'
{"service":"ynx-payd","network":"YNX Testnet","chainId":6423}
EOF
  printf 'HTTP/2 200\ncontent-type: application/json\n' >"$output_dir/health.headers"
  printf 'backend callback fail-closed\n' >"$output_dir/callback.body"
  printf 'HTTP/2 404\n' >"$output_dir/callback.headers"
else
  [[ -f "$PAY_IDENTITY_FILE" && "$(stat -f '%Lp' "$PAY_IDENTITY_FILE")" == "600" ]] || {
    echo "Pay SSH identity missing or not mode 0600" >&2
    exit 67
  }
  ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -i "$PAY_IDENTITY_FILE" \
    -o UserKnownHostsFile="${PAY_KNOWN_HOSTS:?set PAY_KNOWN_HOSTS}" \
    -o ConnectTimeout=10 "${PAY_USER}@${PAY_HOST}" \
    "sudo sha256sum /etc/caddy/ynx-chain.caddy; sudo systemctl show ynx-payd.service --property=ActiveState,SubState,MainPID,NRestarts --no-pager; sudo ss -H -lntp | grep -E '127.0.0.1:(6430|6484)'" \
    >"$output_dir/remote-runtime.txt"
  curl --silent --show-error --location --max-time 20 --dump-header "$output_dir/health.headers" --output "$output_dir/health.body" "$PAY_ORIGIN/health"
  curl --silent --show-error --location --max-time 20 --dump-header "$output_dir/callback.headers" --output "$output_dir/callback.body" "$PAY_ORIGIN/merchant/wallet-auth/callback" || true
fi

rg -F "$PAY_CADDY_SHA256  /etc/caddy/ynx-chain.caddy" "$output_dir/remote-runtime.txt" >/dev/null
rg -F 'ActiveState=active' "$output_dir/remote-runtime.txt" >/dev/null
rg -F 'SubState=running' "$output_dir/remote-runtime.txt" >/dev/null
rg -F 'NRestarts=0' "$output_dir/remote-runtime.txt" >/dev/null
rg -F '127.0.0.1:6430' "$output_dir/remote-runtime.txt" >/dev/null
rg -F '127.0.0.1:6484' "$output_dir/remote-runtime.txt" >/dev/null
node - "$output_dir/health.body" <<'NODE'
const fs = require("fs");
const health = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (health.service !== "ynx-payd" || health.network !== "YNX Testnet" || health.chainId !== 6423) {
  throw new Error("health semantic mismatch");
}
NODE

cat >"$output_dir/browser-preconditions.json" <<EOF
{
  "url": "https://pay.ynxweb4.com/",
  "sourceCommit": "$PAY_SOURCE_COMMIT",
  "sourceTree": "$PAY_SOURCE_TREE",
  "rawResourcesVerified": true,
  "required": ["cold launch", "second launch", "one stable official tab", "default English", "console/page/network errors zero", "Waiting for Wallet without fabricated account or chain"],
  "forbidden": ["eth_requestAccounts", "signature", "typed data", "transaction", "custom scheme"]
}
EOF

(cd "$output_dir" && shasum -a 256 ./* >evidence-sha256.txt)
printf 'pay-public-post-switch-collector: resources, identity, service and browser preconditions pass\n'
