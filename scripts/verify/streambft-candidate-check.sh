#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

go test -count=1 ./internal/streambft
go test -race -count=1 ./internal/streambft

test -s docs/formal/streambft/StreamBFT.tla
test -s docs/formal/streambft/StreamBFT.cfg
test -s docs/architecture/STREAMBFT_CANDIDATE.md

rg -q 'HonestNoEquivocation' docs/formal/streambft/StreamBFT.tla
rg -q 'QuorumIntersection' docs/formal/streambft/StreamBFT.tla
rg -q 'ModeShadow' internal/streambft/mode.go
rg -q 'CometBFTCompositeWin' internal/streambft/mode.go

printf '%s\n' 'StreamBFT local shadow-candidate gate passed; canary/public promotion evidence remains false.'
