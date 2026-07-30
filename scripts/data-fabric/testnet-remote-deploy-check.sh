#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
commit="$(git rev-parse --short=12 HEAD)"
release="ynx-data-fabric-${commit}"
operator_env="$tmp/operator.env"
expected_package="$tmp/expected-package"

node - configs/data-fabric.env.example "$operator_env" "$commit" "$release" <<'NODE'
const fs = require("fs");
const [source, target, commit, release] = process.argv.slice(2);
const values = {
  YNX_DATA_FABRIC_SOURCE_COMMIT: commit,
  YNX_DATA_FABRIC_SOURCE_RELEASE: release,
  YNX_PAY_DATA_FABRIC_SOURCE_URL: "http://127.0.0.1:27620",
  YNX_PAY_DATA_FABRIC_URL: "http://127.0.0.1:8094",
  YNX_PAY_SOURCE_COMMIT: commit,
  YNX_PAY_SOURCE_RELEASE: `ynx-bft-gateway-${commit}`,
  YNX_DATA_FABRIC_PAY_CHAIN_URL: "http://127.0.0.1:27620",
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

scripts/data-fabric/package-public-testnet-release.sh "$expected_package" >/dev/null
expected_archive_sha="$(jq -er '.artifact.sha256' "$expected_package/${release}-release-index.json")"
output="$(
  DEPLOY_DRY_RUN=1 \
  YNX_DATA_FABRIC_TESTNET_HOST=192.0.2.10 \
  YNX_DATA_FABRIC_TESTNET_USER=ynx-operator \
  YNX_DATA_FABRIC_TESTNET_SSH_KEY="$tmp/id_ed25519" \
  YNX_DATA_FABRIC_OPERATOR_ENV="$operator_env" \
  YNX_DATA_FABRIC_EVENT_KEYS_INPUT=configs/data-fabric-event-keys.example.json \
  scripts/data-fabric/deploy-testnet.sh
)"
for required in \
  "DRY RUN scp" \
  "${release}-linux-amd64.tar.gz" \
  "${release}-release-index.json" \
  "--strip-components=1" \
  "public-testnet-release-index.json" \
  "remote-install-testnet-release.sh" \
  "deployment command completed release=$release commit=$commit" \
  "archiveSha256=$expected_archive_sha"; do
  grep -F -- "$required" <<<"$output" >/dev/null || { echo "remote deploy dry-run is missing $required" >&2; exit 1; }
done

node - "$operator_env" "$tmp/bad.env" <<'NODE'
const fs = require("fs");
const [source, target] = process.argv.slice(2);
fs.writeFileSync(target, fs.readFileSync(source, "utf8").replace("YNX_DATA_FABRIC_PAY_LEDGER_ENABLED=true", "YNX_DATA_FABRIC_PAY_LEDGER_ENABLED=false"));
NODE
if DEPLOY_DRY_RUN=1 \
  YNX_DATA_FABRIC_TESTNET_HOST=192.0.2.10 \
  YNX_DATA_FABRIC_TESTNET_USER=ynx-operator \
  YNX_DATA_FABRIC_TESTNET_SSH_KEY="$tmp/id_ed25519" \
  YNX_DATA_FABRIC_OPERATOR_ENV="$tmp/bad.env" \
  YNX_DATA_FABRIC_EVENT_KEYS_INPUT=configs/data-fabric-event-keys.example.json \
  scripts/data-fabric/deploy-testnet.sh >/dev/null 2>&1; then
  echo "remote deploy accepted disabled Pay Ledger reconciliation" >&2
  exit 1
fi
