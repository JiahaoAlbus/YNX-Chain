#!/bin/sh
set -eu
# Run from the repository root; no package install or dependency download here.
if [ "${1:-outbound}" = combined-archive ]; then
  : "${YNX_COMBINED_FUNCTIONAL_INPUTS:?pinned combined functional inputs required}"
  : "${YNX_COMBINED_FUNCTIONAL_INPUTS_SHA256:?combined input SHA256 required}"
  : "${YNX_COMBINED_FUNCTIONAL_OUTPUT:?new external output directory required}"
  node cmd/ynx-secure-link-caller/combined-archive-functional.mjs \
    --inputs "$YNX_COMBINED_FUNCTIONAL_INPUTS" \
    --inputs-sha256 "$YNX_COMBINED_FUNCTIONAL_INPUTS_SHA256" \
    --out "$YNX_COMBINED_FUNCTIONAL_OUTPUT"
  exit 0
fi
if [ "${1:-outbound}" = private-client-startup ]; then
  node --test --test-concurrency=1 --test-timeout=30000 cmd/ynx-secure-link-caller/private-client-startup.test.mjs
  exit 0
fi
if [ "${1:-outbound}" = private-client ]; then
  node --test --test-concurrency=1 --test-timeout=90000 cmd/ynx-secure-link-caller/private-client.test.mjs
  exit 0
fi
if [ "${1:-outbound}" = task-grant ]; then
  node cmd/ynx-secure-link-caller/task-grant-transport-ci.mjs
  exit 0
fi
node cmd/ynx-secure-link-caller/build.mjs
if [ "${1:-outbound}" = inbound ]; then
  node --test --test-timeout=15000 cmd/ynx-secure-link-caller/inbound-caller.test.mjs cmd/ynx-secure-link-caller/local-fence.test.mjs cmd/ynx-secure-link-caller/task-runtime.test.mjs
  exit 0
fi
if [ "${1:-outbound}" = runtime ]; then
  node --test --test-concurrency=1 --test-timeout=15000 cmd/ynx-secure-link-caller/task-runtime.test.mjs
  exit 0
fi
if [ "${1:-outbound}" != outbound ]; then
  printf '%s\n' 'usage: sh cmd/ynx-secure-link-caller/check.sh [outbound|inbound|runtime|task-grant|private-client|private-client-startup|combined-archive]' >&2
  exit 2
fi
node cmd/ynx-secure-link-caller/build.mjs --fork-test
GOMAXPROCS="${GOMAXPROCS:-2}" go build -mod=readonly -p 1 -o cmd/ynx-secure-link-caller/build/go-peer-fixture ./cmd/ynx-secure-link-caller/go-peer-fixture
YNX_CALLER_GO_FIXTURE="$PWD/cmd/ynx-secure-link-caller/build/go-peer-fixture" node --test --test-timeout=15000 cmd/ynx-secure-link-caller/caller.test.mjs cmd/ynx-secure-link-caller/go-integration.test.mjs cmd/ynx-secure-link-caller/fork.test.mjs
