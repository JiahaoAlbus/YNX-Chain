#!/usr/bin/env bash
set -euo pipefail

builder="${YNX_CODE_IMAGE_BUILDER:-ynx-lsp-builder-v2}"
source_alias="${YNX_CODE_SOURCE_IMAGE:-ynx-code-ubuntu-24.04-v1}"
target_alias="${YNX_CODE_TARGET_IMAGE:-ynx-code-ubuntu-24.04-v2}"
probe_path="${YNX_CODE_LSP_PROBE:-$(cd "$(dirname "$0")" && pwd)/lsp-server-probe.mjs}"
rust_analyzer_release="2026-07-27"

command -v lxc >/dev/null
test -f "$probe_path"
if lxc image info "$target_alias" >/dev/null 2>&1; then
  echo "Target image alias already exists: $target_alias" >&2
  exit 1
fi
if ! lxc info "$builder" >/dev/null 2>&1; then
  lxc launch "$source_alias" "$builder" --profile default
fi
cleanup() { lxc delete --force "$builder" >/dev/null 2>&1 || true; }
trap cleanup ERR INT TERM

for _ in $(seq 1 60); do
  if lxc exec "$builder" -- getent hosts archive.ubuntu.com >/dev/null 2>&1; then break; fi
  sleep 1
done
lxc exec "$builder" -- getent hosts archive.ubuntu.com >/dev/null
lxc exec "$builder" -- env DEBIAN_FRONTEND=noninteractive apt-get update -qq
lxc exec "$builder" -- env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  clangd-18=1:18.1.3-1ubuntu1 ca-certificates curl gzip
lxc exec "$builder" -- ln -sfn /usr/bin/clangd-18 /usr/local/bin/clangd
lxc exec "$builder" -- npm install -g --ignore-scripts pyright@1.1.411
lxc exec "$builder" -- ln -sfn /opt/node-v22.23.1/bin/pyright /usr/local/bin/pyright
lxc exec "$builder" -- ln -sfn /opt/node-v22.23.1/bin/pyright-langserver /usr/local/bin/pyright-langserver
lxc exec "$builder" -- env GOBIN=/usr/local/bin GOTOOLCHAIN=local go install golang.org/x/tools/gopls@v0.16.2

lxc exec "$builder" -- env RUST_ANALYZER_RELEASE="$rust_analyzer_release" node -e '
  const fs=require("node:fs"),release=process.env.RUST_ANALYZER_RELEASE;
  fetch("https://api.github.com/repos/rust-lang/rust-analyzer/releases/tags/"+release,{headers:{"user-agent":"ynx-code-image-builder"}})
    .then(r=>{if(!r.ok)throw new Error(String(r.status));return r.json()})
    .then(v=>{const a=v.assets.find(x=>x.name==="rust-analyzer-x86_64-unknown-linux-gnu.gz");if(!a?.digest)throw new Error("verified rust-analyzer asset missing");fs.writeFileSync("/tmp/rust-analyzer-asset",a.browser_download_url+"\n"+a.digest.replace(/^sha256:/,"")+"\n")})
'
asset_url="$(lxc exec "$builder" -- sed -n '1p' /tmp/rust-analyzer-asset)"
asset_sha="$(lxc exec "$builder" -- sed -n '2p' /tmp/rust-analyzer-asset)"
lxc exec "$builder" -- curl -fL --retry 3 "$asset_url" -o /tmp/rust-analyzer.gz
lxc exec "$builder" -- sh -c "printf '%s  %s\n' '$asset_sha' /tmp/rust-analyzer.gz | sha256sum -c -"
lxc exec "$builder" -- sh -c 'gzip -dc /tmp/rust-analyzer.gz > /usr/local/bin/rust-analyzer && chmod 0755 /usr/local/bin/rust-analyzer'

lxc file push "$probe_path" "$builder/tmp/lsp-server-probe.mjs"
lxc exec "$builder" -- node /tmp/lsp-server-probe.mjs
lxc exec "$builder" -- sh -c 'apt-get clean; rm -rf /var/lib/apt/lists/* /root/.cache/go-build /root/go/pkg/mod/cache/download /tmp/rust-analyzer.gz /tmp/rust-analyzer-asset /tmp/lsp-server-probe.mjs'
lxc stop "$builder"
lxc publish "$builder" --alias "$target_alias" description="YNX Code Ubuntu 24.04 reviewed seven-language toolchain and six LSP servers"
fingerprint="$(lxc image info "$target_alias" | awk '/^Fingerprint:/{print $2}')"
test "${#fingerprint}" -eq 64
cleanup
trap - ERR INT TERM
printf 'YNX_CODE_LXD_IMAGE=%s\n' "$fingerprint"
