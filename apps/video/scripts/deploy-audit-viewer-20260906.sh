#!/usr/bin/env bash
# Run on the confirmed primary host as root after copying the exact carrier.
# This changes the Viewer unit only. API, Creator, Caddy and shared current stay intact.
set -Eeuo pipefail
source_sha=d75ad97040041b6febbf4e9ebdb338fdb4c1eff5
carrier_sha=25748a1764e985a8abcd64cac53e25ecbefb7fbc20027142da555ac38fa314f5
carrier=${1:?usage: deploy-audit-viewer-20260906.sh /var/tmp/ynx-video-d75ad9704-runtime.tar.gz}
release=/opt/ynx-video-viewer-wallet/releases/ynx-video-$source_sha
dropin=/etc/systemd/system/ynx-video-viewer.service.d/20260906-audit.conf
unit=ynx-video-viewer.service
[[ $EUID == 0 && $carrier == /var/tmp/ynx-video-d75ad9704-runtime.tar.gz ]]
[[ $(sha256sum "$carrier" | cut -d' ' -f1) == "$carrier_sha" ]]
[[ ! -e $release && ! -e $dropin ]]
[[ -z $(systemctl show "$unit" --property=DropInPaths --value) ]]
[[ $(systemctl show "$unit" --property=User --value) == ynx ]]
[[ $(systemctl show "$unit" --property=Environment --value) == PORT=6494 ]]
[[ $(sha256sum /etc/systemd/system/ynx-video-viewer.service | cut -d' ' -f1) == c0518f813134f2879382cc3f7c999f8abf9b4660c513bc2651487a6fe9ed29c9 ]]
[[ $(sha256sum /opt/ynx-video/current/apps/video/index.html | cut -d' ' -f1) == 5c6aa1b9207680ff40f77df6d063571f67beff40719d727acf5d2fa0c05b591a ]]
[[ $(readlink -f /opt/ynx-video/current) == /opt/ynx-video/releases/p0205-creator-studio-0e1a53c5 ]]
[[ $(systemctl is-active "$unit") == active ]]
! ss -H -ltn 'sport = :16494' | grep -q .

sentinels() {
  systemctl show ynx-videod.service ynx-creator-studio-wallet.service --property=Id,MainPID,ActiveState,ExecMainStartTimestampMonotonic --no-pager
  sha256sum /etc/systemd/system/ynx-videod.service /etc/systemd/system/ynx-creator-studio-wallet.service /etc/systemd/system/ynx-video-viewer.service /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy
  readlink -f /opt/ynx-video/current
  curl -fsS --max-time 10 http://127.0.0.1:6493/health | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6493/version | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6495/ | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6495/creator-studio.manifest.json | sha256sum
  curl -fsS --max-time 10 http://127.0.0.1:6495/i18n/catalog.json | sha256sum
}
before=$(sentinels)
printf 'SOURCE=%s\nCARRIER_SHA256=%s\nBEFORE\n%s\n' "$source_sha" "$carrier_sha" "$before"
installed=0
preview_pid=
recover() {
  local code=$?
  trap - ERR
  if [[ -n $preview_pid ]]; then kill "$preview_pid" 2>/dev/null || true; fi
  if [[ $installed == 1 ]]; then
    rm -- "$dropin"
    systemctl daemon-reload
    systemctl restart "$unit"
    printf 'VIEWER_ROLLBACK=legacy-dropin-removed\n'
    curl -fsS --max-time 10 http://127.0.0.1:6494/ | sha256sum
  fi
  printf 'FAILED_EXIT=%s\n' "$code"
  exit "$code"
}
trap recover ERR
install -d -m 755 "$release"
tar -xzf "$carrier" --strip-components=1 --no-same-owner -C "$release"
python3 - "$release" "$source_sha" <<'PY'
import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1]); m=json.loads((p/'runtime-manifest.json').read_text())
assert m['sourceCommit']==sys.argv[2]
for name,e in m['files'].items():
    q=p/name; assert q.is_file() and not q.is_symlink()
    b=q.read_bytes(); assert len(b)==e['bytes'] and hashlib.sha256(b).hexdigest()==e['sha256'],name
print('MANIFEST_FILES_VERIFIED='+str(len(m['files'])))
PY
chown -R root:root "$release"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
sudo -u ynx test -r "$release/server.mjs"
sudo -u ynx /usr/bin/node --check "$release/server.mjs"
PORT=16494 YNX_VIDEO_API_ORIGIN=http://127.0.0.1:6493 /usr/bin/node "$release/server.mjs" > "$release/preflight.log" 2>&1 &
preview_pid=$!
for attempt in {1..20}; do
  if curl -fsS --max-time 2 http://127.0.0.1:16494/video/api/health >/dev/null 2>&1; then break; fi
  sleep 0.2
done
[[ $(curl -fsS --max-time 5 http://127.0.0.1:16494/app.js | sha256sum | cut -d' ' -f1) == 5d2c10fe5ff1f7916b0659cd22dd3ec0b19fac91b41122b179e3c4864ef8b016 ]]
curl -fsS --max-time 5 http://127.0.0.1:16494/video/api/v1/videos
kill "$preview_pid"
wait "$preview_pid" 2>/dev/null || true
preview_pid=
[[ $(sentinels) == "$before" ]]
install -d -m 755 "$(dirname "$dropin")"
cat > "$dropin" <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/node $release/server.mjs
WorkingDirectory=$release
Environment=PORT=6494
Environment=YNX_VIDEO_API_ORIGIN=http://127.0.0.1:6493
EOF
chmod 644 "$dropin"
installed=1
systemctl daemon-reload
systemctl restart "$unit"
for attempt in {1..20}; do
  if curl -fsS --max-time 2 http://127.0.0.1:6494/runtime-manifest.json >/dev/null 2>&1; then break; fi
  sleep 0.2
done
[[ $(systemctl is-active "$unit") == active ]]
[[ $(curl -fsS --max-time 5 http://127.0.0.1:6494/app.js | sha256sum | cut -d' ' -f1) == 5d2c10fe5ff1f7916b0659cd22dd3ec0b19fac91b41122b179e3c4864ef8b016 ]]
curl -fsS --max-time 5 http://127.0.0.1:6494/video/api/health
[[ $(sentinels) == "$before" ]]
printf '\nAFTER\n%s\n' "$(sentinels)"
printf 'VIEWER_DEPLOYED=%s\nAPI_CREATOR_CADDY_SHARED_UNCHANGED=true\n' "$source_sha"
systemctl show "$unit" --property=MainPID,ExecStart,WorkingDirectory,DropInPaths,Environment --no-pager
sha256sum "$dropin"
date -u '+COMPLETED_AT=%Y-%m-%dT%H:%M:%SZ'
