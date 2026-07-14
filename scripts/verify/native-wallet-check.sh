#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

go test -race ./internal/nativewallet

echo "native-wallet-check passed: ynx1-only native identity, Ed25519 device proof, X25519 key agreement, authenticated encryption, AAD binding, and tamper rejection"
