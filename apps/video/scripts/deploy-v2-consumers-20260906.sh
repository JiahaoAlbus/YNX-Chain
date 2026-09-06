#!/usr/bin/env bash
# Two separately selected, source-frozen upgrades; existing data, ENV and symlinks stay intact.
set -Eeuo pipefail
[[ $EUID == 0 ]]
source=052e95e7027f6eb1352eab5fa15adae157a22b34
mode=${1:?Choose api or creator}
case "$mode" in
 api)
  unit=ynx-videod.service
  artifact=/var/tmp/ynx-videod-052e95e70-linux-amd64
  artifact_sha=e642c8dc8586c87dc1ad29520d0fda768623c54f46d551577f8fb115289a0dc8
  release=/opt/ynx-video/releases/audit-v2-$source
  config=/etc/systemd/system/$unit.d/20260906-v2-consumer.conf
  neighbors='ynx-video-viewer.service ynx-creator-studio-wallet.service'
  [[ $(sha256sum /etc/systemd/system/$unit.d/20260906-executable.conf | cut -d' ' -f1) == eb80c78f51caa0ec902e6afe59a6281ee508331cd1620af73c67748c5f5f3788 ]]
  [[ $(systemctl show "$unit" -p DropInPaths --value) == /etc/systemd/system/$unit.d/20260906-executable.conf ]]
  [[ $(systemctl show "$unit" -p ExecStart --value) == *'/opt/ynx-video/releases/1883d406f77f94cb81171b79fe9518882ede0b16/ynx-videod ;'* ]]
  ;;
 creator)
  unit=ynx-creator-studio-wallet.service
  artifact=/var/tmp/ynx-creator-052e95e70-runtime.tar.gz
  artifact_sha=e8db9cdeee8aa6074bfd61018aa607e27b1ae4bba202e4b7547f54b959546f98
  release=/opt/ynx-creator-studio-wallet/releases/audit-v2-$source
  config=/etc/systemd/system/$unit.d/20260906-v2-consumer.conf
  neighbors='ynx-video-viewer.service ynx-videod.service'
  [[ $(sha256sum /etc/systemd/system/$unit | cut -d' ' -f1) == 06a55f91bf5530952c347db146daa827510cc72f161d999943da7d5737b8c006 ]]
  [[ -z $(systemctl show "$unit" -p DropInPaths --value) ]]
  ;;
 *) exit 2;;
esac
[[ ! -e $release && ! -e $config ]]
[[ $(sha256sum "$artifact" | cut -d' ' -f1) == "$artifact_sha" ]]
[[ $(systemctl show "$unit" -p User --value) == ynx ]]
old_pid=$(systemctl show "$unit" -p MainPID --value)
old_envfiles=$(systemctl show "$unit" -p EnvironmentFiles --value)
[[ $old_pid =~ ^[1-9][0-9]*$ ]]
snapshot() { systemctl show $neighbors -p Id -p MainPID -p ActiveState -p ExecMainStartTimestampMonotonic; }
before_neighbors=$(snapshot)
printf 'MODE=%s\nSOURCE=%s\nARTIFACT_SHA256=%s\nOLD_PID=%s\nNEIGHBORS_BEFORE\n%s\n' "$mode" "$source" "$artifact_sha" "$old_pid" "$before_neighbors"
installed=0
restarted=0
recover() {
 local code=$?
 trap - ERR
 if [[ $installed == 1 ]]; then
  rm -- "$config"
  systemctl daemon-reload
  if [[ $restarted == 1 ]]; then systemctl restart "$unit"; fi
 fi
 printf 'ROLLED_BACK_THIS_DROPIN_ONLY=true\nORIGINAL_DATA_AND_ENV_PRESERVED=true\nFAILED_EXIT=%s\n' "$code"
 systemctl show "$unit" -p Id -p MainPID -p ActiveState -p ExecStart -p WorkingDirectory -p DropInPaths
 exit "$code"
}
trap recover ERR
install -d -m 0755 "$release" "$(dirname "$config")"
if [[ $mode == api ]]; then
 install -m 0755 "$artifact" "$release/ynx-videod"
 sudo -u ynx test -x "$release/ynx-videod"
 cat > "$config" <<EOF
[Service]
ExecStart=
ExecStart=$release/ynx-videod
EOF
else
 tar -xzf "$artifact" -C "$release" --no-same-owner
 chmod -R a+rX "$release"
 node - "$release" "$source" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2],source=process.argv[3];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'creator-studio.manifest.json')));
if(manifest.sourceCommit!==source)throw Error('Source manifest mismatch');
for(const item of manifest.files){const bytes=fs.readFileSync(path.join(root,item.path));if(bytes.length!==item.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Runtime manifest mismatch');}
console.log('CREATOR_MANIFEST_FILES_VERIFIED='+manifest.files.length);
JS
 sudo -u ynx test -r "$release/server.mjs"
 cat > "$config" <<EOF
[Service]
WorkingDirectory=$release
ExecStart=
ExecStart=/usr/bin/node $release/server.mjs
Environment=PORT=6495
Environment=YNX_VIDEO_API_ORIGIN=http://127.0.0.1:6493
EOF
fi
chmod 0644 "$config"
installed=1
systemctl daemon-reload
systemd-analyze verify "$unit"
[[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$old_envfiles" ]]
[[ $(snapshot) == "$before_neighbors" ]]
restarted=1
systemctl restart "$unit"
for attempt in {1..30}; do
 if [[ $mode == api ]]; then probe=http://127.0.0.1:6493/health; else probe=http://127.0.0.1:6495/; fi
 if curl -fsS --max-time 2 "$probe" >/dev/null 2>&1; then break; fi
 sleep 0.2
done
[[ $(systemctl is-active "$unit") == active ]]
[[ $(snapshot) == "$before_neighbors" ]]
if [[ $mode == api ]]; then
 curl -fsS --max-time 10 http://127.0.0.1:6493/version | python3 -c 'import json,sys; v=json.load(sys.stdin); assert v["build"]["commit"]=="052e95e7027f6eb1352eab5fa15adae157a22b34",v; print(json.dumps(v))'
 curl -fsS --max-time 10 http://127.0.0.1:6493/health
 curl -fsS --max-time 10 http://127.0.0.1:6493/v1/videos
 [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:6493/v1/studio) == 401 ]]
 [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -H 'X-YNX-Product-Session-Proof-V2: invalid' -H 'Origin: https://creator.ynxweb4.com' http://127.0.0.1:6493/v1/studio) == 401 ]]
 echo MISSING_AND_INVALID_PROOFS_REJECTED=true
 new_pid=$(systemctl show "$unit" -p MainPID --value)
 [[ $(sha256sum "/proc/$new_pid/exe" | cut -d' ' -f1) == "$artifact_sha" ]]
else
 curl -fsS --max-time 10 http://127.0.0.1:6495/creator-studio.manifest.json | python3 -c 'import json,sys; v=json.load(sys.stdin); assert v["sourceCommit"]=="052e95e7027f6eb1352eab5fa15adae157a22b34"; print("CREATOR_RUNTIME_SOURCE="+v["sourceCommit"])'
 for path in wallet-auth/callback wallet-callback.js callback.css product-session.js product-session-sdk.js product-session-registry.json video/api/health; do curl -fsS --max-time 10 "http://127.0.0.1:6495/$path" >/dev/null; done
fi
trap - ERR
printf '\nNEIGHBORS_AFTER\n%s\n' "$(snapshot)"
systemctl show "$unit" -p Id -p MainPID -p ActiveState -p ExecStart -p WorkingDirectory -p EnvironmentFiles -p DropInPaths -p NRestarts
sha256sum "$config"
date -u '+COMPLETED_AT=%Y-%m-%dT%H:%M:%SZ'
echo V2_CONSUMER_DEPLOYED=true
