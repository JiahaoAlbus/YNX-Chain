#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
collector="$repo_root/apps/pay/scripts/pay-public-post-switch-collector-p0225.sh"
candidate_tar="$repo_root/release/pay/ynx-pay-web-5f4ce98e-static.tar.gz"
fixture_root="$(mktemp -d /tmp/ynx-pay-collector-zsh-fixture.XXXXXX)"
trap 'rm -rf "$fixture_root"' EXIT
mkdir "$fixture_root/extracted"
tar -xzf "$candidate_tar" -C "$fixture_root/extracted"

COLLECTOR="$collector" FIXTURE_DIST="$fixture_root/extracted/dist" FIXTURE_OUT="$fixture_root/output" zsh -f <<'ZSH'
set -euo pipefail
original_path="$PATH"
"$COLLECTOR" --fixture "$FIXTURE_DIST" "$FIXTURE_OUT"
[[ "$PATH" == "$original_path" ]]
command -v tr >/dev/null
command -v shasum >/dev/null
[[ -f "$FIXTURE_OUT/index.html.body" ]]
[[ -f "$FIXTURE_OUT/build-identity.json.body" ]]
[[ -f "$FIXTURE_OUT/release-manifest.json.body" ]]
[[ -f "$FIXTURE_OUT/assets_assets_ynx-logo.a0b95fd9058a835ba2786aeb2287e0b7.png.body" ]]
[[ -f "$FIXTURE_OUT/browser-preconditions.json" ]]
ZSH

node - "$fixture_root/output/resource-summary.json" <<'NODE'
const fs = require("fs");
const summary = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (summary.sourceCommit !== "5f4ce98eb458550b976c17e3bc6d77cce4081a59") throw new Error("source mismatch");
if (summary.resources.length !== 8) throw new Error(`expected 8 distinct resources, got ${summary.resources.length}`);
NODE

if rg -n 'read -r path|local path=' "$collector"; then
  echo "collector reintroduced zsh-special path variable" >&2
  exit 1
fi

printf 'pay-public-post-switch-collector-zsh-fixture: four resource classes, PATH preservation and browser preconditions pass\n'
