#!/bin/bash
set -euo pipefail

stat_tuple() {
  if [[ -e "$1" || -L "$1" ]]; then
    /usr/bin/stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"
  else
    printf 'ABSENT\n'
  fi
}

file_receipt() {
  local label="$1" path="$2"
  printf '%sTuple=' "$label"
  stat_tuple "$path"
  if [[ -f "$path" && ! -L "$path" ]]; then
    printf '%sSha256=' "$label"
    /usr/bin/sha256sum -- "$path" | /usr/bin/cut -d' ' -f1
    printf '%sJsonValid=' "$label"
    if /usr/bin/jq -e . "$path" >/dev/null 2>&1; then printf 'true\n'; else printf 'false\n'; fi
    printf '%sStatus=' "$label"
    /usr/bin/jq -r '.status // "MISSING"' "$path" 2>/dev/null || printf 'UNPARSEABLE\n'
  fi
}

printf 'inspection=CREATOR_P0305_EMERGENCY_ZERO_WRITE_STATE_FREEZE\n'
for entry in \
  controlRoot:/opt/ynx-release-control-plane/creator-studio-3f97a13d \
  controlStage:/opt/ynx-release-control-plane/creator-studio-3f97a13d.next \
  oldRelease:/opt/ynx-creator-studio-wallet/releases/creator-studio-0e1a53c5 \
  candidateRelease:/opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d \
  candidateStage:/opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d.next \
  current:/opt/ynx-creator-studio-wallet/current \
  currentNext:/opt/ynx-creator-studio-wallet/current.next-3f97a13d; do
  label="${entry%%:*}"
  path="${entry#*:}"
  printf '%sTuple=' "$label"
  stat_tuple "$path"
done

printf 'currentTarget='; /usr/bin/readlink -- /opt/ynx-creator-studio-wallet/current 2>/dev/null || printf 'NOT_SYMLINK\n'
printf 'currentResolved='; /usr/bin/readlink -f -- /opt/ynx-creator-studio-wallet/current 2>/dev/null || printf 'UNRESOLVED\n'
file_receipt forwardReceipt /opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json
file_receipt forwardReceiptNext /opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json.next

for root in /opt/ynx-creator-studio-wallet/releases/creator-studio-0e1a53c5 /opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d; do
  label=old
  [[ "$root" == *3f97a13d ]] && label=candidate
  if [[ -f "$root/creator-studio.manifest.json" && ! -L "$root/creator-studio.manifest.json" ]]; then
    printf '%sManifestTuple=' "$label"; stat_tuple "$root/creator-studio.manifest.json"
    printf '%sManifestSha256=' "$label"; /usr/bin/sha256sum -- "$root/creator-studio.manifest.json" | /usr/bin/cut -d' ' -f1
    printf '%sManifestSource=' "$label"; /usr/bin/jq -r '[.sourceCommit,.sourceTree]|@tsv' "$root/creator-studio.manifest.json" 2>/dev/null || printf 'UNPARSEABLE\n'
  fi
done

printf 'unitTuple='; stat_tuple /etc/systemd/system/ynx-creator-studio-wallet.service
printf 'unitSha256='; /usr/bin/sha256sum -- /etc/systemd/system/ynx-creator-studio-wallet.service | /usr/bin/cut -d' ' -f1
for service in ynx-creator-studio-wallet.service ynx-video-studio.service ynx-video-viewer.service ynx-videod.service; do
  printf '%s=' "$service"
  /usr/bin/systemctl show "$service" -p LoadState -p ActiveState -p SubState -p MainPID -p NRestarts --value | /usr/bin/paste -sd: -
done
printf 'listeners='; /usr/bin/ss -ltnp '( sport = :6493 or sport = :6494 or sport = :6495 )' | /usr/bin/tail -n +2 | /usr/bin/tr '\n' ';'; printf '\n'

for path in '' app.js creator-studio.manifest.json i18n.js i18n/catalog.json; do
  url="https://web4.ynxweb4.com/video/studio/$path"
  printf 'public:%s:meta=' "$path"
  /usr/bin/curl -sS --max-time 15 -o /dev/null -w '%{http_code}:%{size_download}:%{content_type}\n' "$url"
  printf 'public:%s:sha=' "$path"
  /usr/bin/curl -sS --max-time 15 "$url" | /usr/bin/sha256sum | /usr/bin/cut -d' ' -f1
done

printf 'mutationCount=0\n'
printf 'inspectionComplete=true\n'
