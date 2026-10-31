#!/usr/bin/env bash
set -euo pipefail
: "${BASELINE_ROOT:?Set a NEW external private experiment artifact root}"
: "${GO_BINARY:?Set the existing Go1.26.10 executable}"
: "${READONLY_MODULE_PROXY:?Set existing read-only file module proxy}"
[[ "$BASELINE_ROOT" = /* ]]
if [[ "${YNX_SLH_IMMUTABLE_RUNNER:-}" != 1 ]]; then
 mkdir -p "$BASELINE_ROOT"
 runner_copy="$(mktemp -d "$BASELINE_ROOT/runner-snapshot.XXXXXX")"
 cp "$0" "$runner_copy/run-internal-experiment.sh"
 cp experiments/wallet-slh-provider/run-baseline.sh "$runner_copy/run-baseline.sh"
 chmod a-w "$runner_copy/run-internal-experiment.sh" "$runner_copy/run-baseline.sh"
 shasum -a 256 "$runner_copy/run-internal-experiment.sh" "$runner_copy/run-baseline.sh" > "$runner_copy/snapshot.sha256"
 exec env YNX_SLH_IMMUTABLE_RUNNER=1 YNX_SLH_BASELINE_RUNNER="$runner_copy/run-baseline.sh" /bin/bash "$runner_copy/run-internal-experiment.sh"
fi
export GOFLAGS='-tags=ynxslhexperiment -modfile=experiments/wallet-slh-provider/slh-experiment.mod'
export GOMAXPROCS=2
export RUN_LABEL="${RUN_LABEL:-after-formal}"
export YNX_SLH_BASELINE_SAMPLES="${YNX_SLH_BASELINE_SAMPLES:-1000}"
/bin/bash "${YNX_SLH_BASELINE_RUNNER:?Original private runner snapshot required}"
