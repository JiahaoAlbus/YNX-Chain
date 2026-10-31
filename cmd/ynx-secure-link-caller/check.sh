#!/bin/sh
set -eu
# Run from the repository root; no package install or dependency download here.
node cmd/ynx-secure-link-caller/build.mjs
if [ "${1:-outbound}" = inbound ]; then
  node --test --test-timeout=15000 cmd/ynx-secure-link-caller/inbound-caller.test.mjs
  exit 0
fi
if [ "${1:-outbound}" != outbound ]; then
  printf '%s\n' 'usage: sh cmd/ynx-secure-link-caller/check.sh [outbound|inbound]' >&2
  exit 2
fi
node cmd/ynx-secure-link-caller/build.mjs --fork-test
GOMAXPROCS="${GOMAXPROCS:-2}" go build -mod=readonly -p 1 -o cmd/ynx-secure-link-caller/build/go-peer-fixture ./cmd/ynx-secure-link-caller/go-peer-fixture
YNX_CALLER_GO_FIXTURE="$PWD/cmd/ynx-secure-link-caller/build/go-peer-fixture" node --test --test-timeout=15000 cmd/ynx-secure-link-caller/caller.test.mjs cmd/ynx-secure-link-caller/go-integration.test.mjs cmd/ynx-secure-link-caller/fork.test.mjs
