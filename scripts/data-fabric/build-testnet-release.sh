#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

output="${1:-tmp/data-fabric-testnet-release}"
system_tmp="${TMPDIR:-/tmp}"
system_tmp="${system_tmp%/}"
case "$output" in
  tmp/*) output="$root/$output" ;;
  "$root"/tmp/* | "$system_tmp"/* | /tmp/* | /private/tmp/*) ;;
  *) echo "output must be under repository tmp/ or the system temporary directory" >&2; exit 1 ;;
esac

commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
build_time="$(git show -s --format=%cI HEAD)"
stage="${output%/}/${release}"

rm -rf "$stage"
mkdir -p "$stage/bin" "$stage/config" "$stage/scripts" "$stage/systemd"

for command in ynx-data-fabricctl ynx-data-fabricd ynx-data-fabric-worker ynx-pay-data-fabric-bridge; do
  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -buildvcs=true -o "$stage/bin/$command" "./cmd/$command"
done

install -m 0644 configs/data-fabric.env.example "$stage/config/data-fabric.env"
install -m 0644 configs/data-fabric-event-keys.example.json "$stage/config/event-keys.json"
for unit in infra/data-fabric/systemd/*.service; do
  install -m 0644 "$unit" "$stage/systemd/$(basename "$unit")"
done
install -m 0755 scripts/data-fabric/install-testnet-release.sh "$stage/scripts/install-testnet-release.sh"
install -m 0755 scripts/data-fabric/remote-install-testnet-release.sh "$stage/scripts/remote-install-testnet-release.sh"
install -m 0755 scripts/data-fabric/verify-testnet-deployment.sh "$stage/scripts/verify-testnet-deployment.sh"

node scripts/data-fabric/write-testnet-release-manifest.mjs "$stage" "$commit" "$release" "$build_time"
node scripts/data-fabric/verify-testnet-release.mjs "$stage" "$commit" "$release" >&2
printf '%s\n' "$stage"
