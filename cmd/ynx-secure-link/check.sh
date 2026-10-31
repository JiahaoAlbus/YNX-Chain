#!/bin/sh
set -eu
# Run from the repository root. Default checks are already included by the
# original `make test`; the native mode is the minimal extra CI owner hook.
export GOMAXPROCS="${GOMAXPROCS:-2}"
case "${1:-stub}" in
  stub)
    go test -p 1 ./internal/securelink/... ./cmd/ynx-secure-link
    ;;
  native)
    test "$(pkg-config --modversion openssl)" = "3.6.4"
    go test -race -p 1 -tags securelink_openssl ./internal/securelink/... ./cmd/ynx-secure-link
    go vet -tags securelink_openssl ./internal/securelink/... ./cmd/ynx-secure-link
    ;;
  *) printf '%s\n' 'usage: sh cmd/ynx-secure-link/check.sh [stub|native]' >&2; exit 2 ;;
esac
