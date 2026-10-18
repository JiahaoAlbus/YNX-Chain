#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

go test -count=1 ./internal/streambft
go test -race -count=1 ./internal/streambft

test -s docs/formal/streambft/StreamBFT.tla
test -s docs/formal/streambft/StreamBFT.cfg
test -s docs/architecture/STREAMBFT_CANDIDATE.md

contains_literal() {
  local pattern="$1"
  local path="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -q -- "$pattern" "$path"
  else
    grep -Fq -- "$pattern" "$path"
  fi
}

contains_literal 'HonestNoEquivocation' docs/formal/streambft/StreamBFT.tla
contains_literal 'QuorumIntersection' docs/formal/streambft/StreamBFT.tla
contains_literal 'ModeShadow' internal/streambft/mode.go
contains_literal 'CometBFTCompositeWin' internal/streambft/mode.go

printf '%s\n' 'StreamBFT local shadow-candidate gate passed; canary/public promotion evidence remains false.'
