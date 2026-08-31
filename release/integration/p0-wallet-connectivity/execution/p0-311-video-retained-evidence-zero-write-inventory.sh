#!/bin/bash
set -euo pipefail

parent=/var/lib/ynx-video-viewer-wallet-evidence
identity=/var/lib/ynx-video-viewer-wallet-evidence.identity

tuple() {
  if [[ -e "$1" || -L "$1" ]]; then
    /usr/bin/stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"
  else
    printf 'ABSENT\n'
  fi
}

record() {
  local label=$1 path=$2 encoded kind digest=-
  encoded=$(printf '%s' "$path" | /usr/bin/base64 | /usr/bin/tr -d '\n')
  kind=$(tuple "$path")
  if [[ -f "$path" && ! -L "$path" ]]; then
    digest=$(/usr/bin/sha256sum -- "$path" | /usr/bin/cut -d' ' -f1)
  fi
  printf 'OBJECT\t%s\t%s\t%s\t%s\n' "$label" "$encoded" "$kind" "$digest"
}

printf 'inspection=VIDEO_RETAINED_EVIDENCE_ZERO_WRITE_DIRECT_INVENTORY\n'
record parent "$parent"
record identity "$identity"
[[ -d "$parent" && ! -L "$parent" ]] || { printf 'inspectionComplete=false\n'; exit 65; }
printf 'directChildrenBegin=true\n'
count=0
directories=0
while IFS= read -r -d '' child; do
  count=$((count + 1))
  [[ -d "$child" && ! -L "$child" ]] && directories=$((directories + 1))
  record child "$child"
done < <(/usr/bin/find "$parent" -mindepth 1 -maxdepth 1 -print0 | /usr/bin/sort -z)
printf 'directChildrenEnd=true\n'
printf 'directChildCount=%s\n' "$count"
printf 'directSubdirectoryCount=%s\n' "$directories"
printf 'mutationCount=0\n'
printf 'inspectionComplete=true\n'
