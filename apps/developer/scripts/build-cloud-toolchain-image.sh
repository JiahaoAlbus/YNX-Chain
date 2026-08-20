#!/usr/bin/env bash
set -euo pipefail

builder="${YNX_CODE_IMAGE_BUILDER:-ynx-lsp-builder-v3}"
source_alias="${YNX_CODE_SOURCE_IMAGE:-ynx-code-ubuntu-24.04-v2}"
target_alias="${YNX_CODE_TARGET_IMAGE:-ynx-code-ubuntu-24.04-v3}"
probe_path="${YNX_CODE_LSP_PROBE:-$(cd "$(dirname "$0")" && pwd)/lsp-server-probe.mjs}"
jdtls_launcher_path="$(cd "$(dirname "$0")" && pwd)/jdtls-launcher.sh"
delve_bridge_path="$(cd "$(dirname "$0")" && pwd)/delve-dap-stdio-bridge.mjs"
js_debug_bridge_path="$(cd "$(dirname "$0")" && pwd)/js-debug-dap-stdio-bridge.mjs"
apt_sources_path="$(cd "$(dirname "$0")" && pwd)/apt/ubuntu.sources"
rust_analyzer_release="2026-07-27"
jdtls_archive="jdt-language-server-1.61.0-202607142124.tar.gz"
jdtls_sha256="4dc0747f22fb86dfada4c9214d3ef94c94f1e84eb57ce52126c26ecf2f17dce4"
junit_version="1.14.2"
junit_sha256="5566ffe2aa48263867bca745925f73bf7b01591b30d9a60f191c0b16fa0955e9"
debugpy_version="1.8.21"
debugpy_sha256="b1e37d333663c8851516a47364ef473da127f9caebe4417e6df6f5825a7e9a92"
debugpy_url="https://files.pythonhosted.org/packages/95/51/67e7cf11a53e40694f720457d5b3a1cdaaa3d5a9a633e482f225456b93ff/debugpy-1.8.21-py2.py3-none-any.whl"
js_debug_version="1.117.0"
js_debug_sha256="ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772"
js_debug_url="https://github.com/microsoft/vscode-js-debug/releases/download/v${js_debug_version}/js-debug-dap-v${js_debug_version}.tar.gz"
package_network="${YNX_CODE_LXD_PACKAGE_NETWORK:?Set YNX_CODE_LXD_PACKAGE_NETWORK to the reviewed package-egress LXD network}"
storage_pool="${YNX_CODE_IMAGE_STORAGE_POOL:-default}"

command -v lxc >/dev/null
test -f "$probe_path"
test -f "$jdtls_launcher_path"
test -f "$delve_bridge_path"
test -f "$js_debug_bridge_path"
test -f "$apt_sources_path"
[[ $package_network == ynx-pkg-egress ]] || { echo "YNX_CODE_LXD_PACKAGE_NETWORK does not match the reviewed production network" >&2; exit 1; }
[[ $storage_pool =~ ^[A-Za-z0-9_.-]{1,80}$ ]] || { echo "YNX_CODE_IMAGE_STORAGE_POOL is invalid" >&2; exit 1; }
if lxc image info "$target_alias" >/dev/null 2>&1; then
  echo "Target image alias already exists: $target_alias" >&2
  exit 1
fi
cleanup() { lxc delete --force "$builder" >/dev/null 2>&1 || true; }
on_error() {
  local status=$? line=${BASH_LINENO[0]:-unknown}
  printf 'YNX_CODE_IMAGE_BUILD_FAILED status=%s line=%s\n' "$status" "$line" >&2
  cleanup
  exit "$status"
}
trap on_error ERR
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
if lxc info "$builder" >/dev/null 2>&1; then
  echo "Builder instance already exists: $builder" >&2
  exit 1
fi
lxc init "$source_alias" "$builder" --no-profiles --storage "$storage_pool"
lxc config device add "$builder" ynx-package-egress nic network="$package_network" name=eth0
lxc start "$builder"

for _ in $(seq 1 60); do
  if lxc exec "$builder" -- getent hosts archive.ubuntu.com >/dev/null 2>&1; then break; fi
  sleep 1
done
lxc exec "$builder" -- getent hosts archive.ubuntu.com >/dev/null
if lxc exec "$builder" -- test -x /usr/bin/cloud-init; then
  lxc exec "$builder" -- timeout 180 cloud-init status --wait
fi
lxc file push "$apt_sources_path" "$builder/etc/apt/sources.list.d/ubuntu.sources"
if lxc exec "$builder" -- grep -R -E "^[[:space:]]*(deb[[:space:]]+|URIs:[[:space:]]*)http://" /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null; then
  echo "Ubuntu APT sources must use HTTPS under reviewed package egress" >&2
  exit 1
fi
lxc exec "$builder" -- grep -R -E "^[[:space:]]*(deb[[:space:]]+|URIs:[[:space:]]*)https://" /etc/apt/sources.list /etc/apt/sources.list.d
lxc exec "$builder" -- rm -rf /var/lib/apt/lists/*
lxc exec "$builder" -- env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 update -qq
lxc exec "$builder" -- env DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=3 install -y --no-install-recommends \
  clangd-18=1:18.1.3-1ubuntu1 lldb-18=1:18.1.3-1ubuntu1 rustfmt=1.75.0+dfsg0ubuntu1-0ubuntu7.4 ca-certificates curl gzip openjdk-21-jdk-headless python3-pip python3-venv
lxc exec "$builder" -- ln -sfn /usr/bin/clangd-18 /usr/local/bin/clangd
lxc exec "$builder" -- test -x /usr/bin/lldb-dap-18
lxc exec "$builder" -- sh -c 'dpkg-query -W -f="\${Package}=\${Version}\n" lldb-18 liblldb-18 > /etc/ynx-code-lldb-packages.txt'
lxc exec "$builder" -- npm install -g --ignore-scripts pyright@1.1.411
lxc exec "$builder" -- ln -sfn /opt/node-v22.23.1/bin/pyright /usr/local/bin/pyright
lxc exec "$builder" -- ln -sfn /opt/node-v22.23.1/bin/pyright-langserver /usr/local/bin/pyright-langserver
lxc exec "$builder" -- env GOBIN=/usr/local/bin GOTOOLCHAIN=local go install golang.org/x/tools/gopls@v0.16.2
lxc exec "$builder" -- env GOBIN=/usr/local/bin GOTOOLCHAIN=local go install github.com/go-delve/delve/cmd/dlv@v1.25.2
lxc exec "$builder" -- sh -c '/usr/local/bin/dlv version | grep "Version: 1.25.2"'
lxc exec "$builder" -- sh -c 'go version -m /usr/local/bin/dlv | tee /etc/ynx-code-delve-build.txt | grep "github.com/go-delve/delve.*v1.25.2"'

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
lxc exec "$builder" -- sh -c 'javac -version && java -version && dpkg-query -W -f="\${Package}=\${Version}\n" openjdk-21-jdk-headless openjdk-21-jre-headless > /etc/ynx-code-jdk-packages.txt'
lxc exec "$builder" -- curl --http1.1 -fL --retry 10 --retry-all-errors --connect-timeout 20 "https://download.eclipse.org/jdtls/snapshots/$jdtls_archive" -o "/tmp/$jdtls_archive"
lxc exec "$builder" -- sh -c "printf '%s  %s\n' '$jdtls_sha256' '/tmp/$jdtls_archive' | sha256sum -c -"
lxc exec "$builder" -- mkdir -p /usr/local/lib/ynx-code-jdtls
lxc exec "$builder" -- tar --no-same-owner -xzf "/tmp/$jdtls_archive" -C /usr/local/lib/ynx-code-jdtls
lxc file push "$jdtls_launcher_path" "$builder/usr/local/lib/ynx-code-jdtls/bin/ynx-jdtls"
lxc exec "$builder" -- chmod 0755 /usr/local/lib/ynx-code-jdtls/bin/ynx-jdtls
lxc exec "$builder" -- ln -sfn /usr/local/lib/ynx-code-jdtls/bin/ynx-jdtls /usr/local/bin/jdtls
lxc exec "$builder" -- mkdir -p /usr/local/share/ynx-code
lxc exec "$builder" -- mkdir -p /usr/local/lib/ynx-code
lxc file push "$delve_bridge_path" "$builder/usr/local/lib/ynx-code/delve-dap-stdio-bridge.mjs"
lxc exec "$builder" -- chmod 0755 /usr/local/lib/ynx-code/delve-dap-stdio-bridge.mjs
lxc file push "$js_debug_bridge_path" "$builder/usr/local/lib/ynx-code/js-debug-dap-stdio-bridge.mjs"
lxc exec "$builder" -- chmod 0755 /usr/local/lib/ynx-code/js-debug-dap-stdio-bridge.mjs
lxc exec "$builder" -- curl --http1.1 --proto '=https' --tlsv1.2 -fL --retry 10 --retry-all-errors --connect-timeout 20 "$js_debug_url" -o "/tmp/js-debug-${js_debug_version}.tar.gz"
lxc exec "$builder" -- sh -c "printf '%s  %s\n' '$js_debug_sha256' '/tmp/js-debug-${js_debug_version}.tar.gz' | sha256sum -c -"
lxc exec "$builder" -- mkdir -p /opt/ynx-js-debug
lxc exec "$builder" -- tar --no-same-owner -xzf "/tmp/js-debug-${js_debug_version}.tar.gz" --strip-components=1 -C /opt/ynx-js-debug
lxc exec "$builder" -- sh -c 'printf '\''{"type":"commonjs"}\n'\'' > /opt/ynx-js-debug/package.json'
lxc exec "$builder" -- test -f /opt/ynx-js-debug/LICENSE
lxc exec "$builder" -- /opt/node-v22.23.1/bin/node /opt/ynx-js-debug/src/dapDebugServer.js --help
lxc exec "$builder" -- curl --http1.1 -fL --retry 10 --retry-all-errors --connect-timeout 20 "https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/$junit_version/junit-platform-console-standalone-$junit_version.jar" -o /usr/local/share/ynx-code/junit-platform-console-standalone.jar
lxc exec "$builder" -- sh -c "printf '%s  %s\n' '$junit_sha256' /usr/local/share/ynx-code/junit-platform-console-standalone.jar | sha256sum -c -"
lxc exec "$builder" -- java -jar /usr/local/share/ynx-code/junit-platform-console-standalone.jar --version
lxc exec "$builder" -- sh -c 'rustc --version | grep "^rustc 1.75.0 "'
lxc exec "$builder" -- sh -c 'cargo --version | grep "^cargo 1.75.0$"'
lxc exec "$builder" -- sh -c 'rustfmt --version | grep "^rustfmt 1.7.0-stable "'
lxc exec "$builder" -- sh -c 'python3 -m venv --copies /tmp/ynx-python-package-probe && /tmp/ynx-python-package-probe/bin/python -m pip --version && rm -rf /tmp/ynx-python-package-probe && dpkg-query -W -f="\${Package}=\${Version}\n" python3-pip python3-venv > /etc/ynx-code-python-packages.txt'
lxc exec "$builder" -- curl --proto '=https' --tlsv1.2 -fL --retry 4 --connect-timeout 20 "$debugpy_url" -o "/tmp/debugpy-${debugpy_version}-py2.py3-none-any.whl"
lxc exec "$builder" -- sh -c "printf '%s  %s\n' '$debugpy_sha256' '/tmp/debugpy-${debugpy_version}-py2.py3-none-any.whl' | sha256sum -c -"
lxc exec "$builder" -- python3 -m venv --copies /opt/ynx-debugpy
lxc exec "$builder" -- /opt/ynx-debugpy/bin/python -m pip install --no-index --no-deps "/tmp/debugpy-${debugpy_version}-py2.py3-none-any.whl"
lxc exec "$builder" -- /opt/ynx-debugpy/bin/python -c "import debugpy,sys; sys.exit(0 if debugpy.__version__ == '$debugpy_version' else 1)"

lxc file push "$probe_path" "$builder/tmp/lsp-server-probe.mjs"
lxc exec "$builder" -- node /tmp/lsp-server-probe.mjs
lxc exec "$builder" -- sh -c "apt-get clean; rm -rf /var/lib/apt/lists/* /root/.cache/go-build /root/go/pkg/mod/cache/download /tmp/rust-analyzer.gz /tmp/rust-analyzer-asset /tmp/lsp-server-probe.mjs '/tmp/$jdtls_archive' '/tmp/debugpy-${debugpy_version}-py2.py3-none-any.whl' '/tmp/js-debug-${js_debug_version}.tar.gz'"
lxc stop "$builder"
lxc publish "$builder" --alias "$target_alias" description="YNX Code Ubuntu 24.04 reviewed nine-language toolchain, Python debugpy, Rust LLDB, Go Delve and Node js-debug DAP, JUnit and seven LSP servers"
fingerprint="$(lxc image info "$target_alias" | awk '/^Fingerprint:/{print $2}')"
test "${#fingerprint}" -eq 64
cleanup
trap - ERR INT TERM
printf 'YNX_CODE_LXD_IMAGE=%s\n' "$fingerprint"
