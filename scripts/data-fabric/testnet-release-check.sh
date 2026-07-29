#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

stage="$(scripts/data-fabric/build-testnet-release.sh "$tmp")"
commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
[[ "$stage" == "$tmp/$release" ]]
node scripts/data-fabric/verify-testnet-release.mjs "$stage" "$commit" "$release"

operator_env="$tmp/operator.env"
node - "$stage/config/data-fabric.env" "$operator_env" "$commit" "$release" <<'NODE'
const fs = require("fs");
const [source, target, commit, release] = process.argv.slice(2);
const values = {
  YNX_DATA_FABRIC_SOURCE_COMMIT: commit,
  YNX_DATA_FABRIC_SOURCE_RELEASE: release,
  YNX_PAY_DATA_FABRIC_SOURCE_URL: "http://127.0.0.1:6438",
  YNX_PAY_DATA_FABRIC_URL: "http://127.0.0.1:8094",
  YNX_PAY_SOURCE_COMMIT: commit,
  YNX_PAY_SOURCE_RELEASE: `ynx-bft-gateway-${commit}`,
  YNX_DATA_FABRIC_PAY_CHAIN_URL: "http://127.0.0.1:6438",
  YNX_DATA_FABRIC_PAY_CHAIN_COMMIT: commit,
  YNX_DATA_FABRIC_PAY_CHAIN_RELEASE: `ynx-bft-gateway-${commit}`,
};
const body = fs.readFileSync(source, "utf8").split("\n").map((line) => {
  const separator = line.indexOf("=");
  if (separator < 0) return line;
  const name = line.slice(0, separator);
  return Object.hasOwn(values, name) ? `${name}=${values[name]}` : line;
}).join("\n");
fs.writeFileSync(target, body, {mode: 0o600});
NODE
"$stage/scripts/install-testnet-release.sh" --dry-run "$stage" "$operator_env" "$stage/config/event-keys.json" |
  grep -F "validated install plan release=$release commit=$commit" >/dev/null

bad_env="$tmp/bad-operator.env"
node - "$operator_env" "$bad_env" <<'NODE'
const fs = require("fs");
const [source, target] = process.argv.slice(2);
fs.writeFileSync(target, fs.readFileSync(source, "utf8").replace("YNX_PAY_DATA_FABRIC_SOURCE_MODE=bft", "YNX_PAY_DATA_FABRIC_SOURCE_MODE=authoritative"));
NODE
if "$stage/scripts/install-testnet-release.sh" --dry-run "$stage" "$bad_env" "$stage/config/event-keys.json" >/dev/null 2>&1; then
  echo "installer accepted a non-BFT Pay source" >&2
  exit 1
fi

cp -R "$stage" "$tmp/tampered"
printf 'tampered\n' >> "$tmp/tampered/systemd/ynx-pay-data-fabric-bridge.service"
if node scripts/data-fabric/verify-testnet-release.mjs "$tmp/tampered" "$commit" "$release" >/dev/null 2>&1; then
  echo "tampered Testnet release passed integrity verification" >&2
  exit 1
fi
