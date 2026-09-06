#!/usr/bin/env bash
# Frozen source and carriers. Invoke api first, then viewer. Preserve all old releases.
set -Eeuo pipefail
[[ $EUID == 0 ]]
source=48fe3824cc6a38ba944427776e48d076f27f54f5
mode=${1:?Choose api or viewer}
case "$mode" in
 api)
  unit=ynx-videod.service
  artifact=/var/tmp/ynx-videod-48fe3824c-linux-amd64
  artifact_sha=d9eb2016902351f5144054cb2996a3e75dbfb0af66a1286f67ab5b4303b02174
  release=/opt/ynx-video/releases/audit-library-$source
  config=/etc/systemd/system/$unit.d/20260906-v4-library.conf
  neighbors='ynx-video-viewer.service ynx-creator-studio-wallet.service ynx-wallet-gateway.service'
  [[ $(sha256sum /etc/systemd/system/$unit.d/20260906-v2-consumer.conf | cut -d' ' -f1) == 6aa732ad280b9e637eb4cee5a0bc662e3d1ccbd15391ab2ef7f4861370ff911a ]]
  [[ $(systemctl show "$unit" -p DropInPaths --value) == "/etc/systemd/system/$unit.d/20260906-executable.conf /etc/systemd/system/$unit.d/20260906-v2-consumer.conf" ]]
  [[ $(systemctl show "$unit" -p ExecStart --value) == *'/opt/ynx-video/releases/audit-v2-052e95e7027f6eb1352eab5fa15adae157a22b34/ynx-videod ;'* ]]
  port=6493
  ;;
 viewer)
  unit=ynx-video-viewer.service
  artifact=/var/tmp/ynx-video-48fe3824c-runtime.tar.gz
  artifact_sha=78d504099bc1fbdbe54f3c04fb3f3d523b96857d8a513817db1600a829c36b2c
  release=/opt/ynx-video-viewer-wallet/releases/ynx-video-$source
  config=/etc/systemd/system/$unit.d/20260906-library-v2.conf
  neighbors='ynx-videod.service ynx-creator-studio-wallet.service ynx-wallet-gateway.service'
  [[ $(sha256sum /etc/systemd/system/$unit.d/20260906-audit.conf | cut -d' ' -f1) == 197e6d7ada5dc4a38d2df7e61ff597ea644b1aa47bf4e38c1d390961c9a0dbac ]]
  [[ $(systemctl show "$unit" -p DropInPaths --value) == /etc/systemd/system/$unit.d/20260906-audit.conf ]]
  [[ $(systemctl show "$unit" -p WorkingDirectory --value) == /opt/ynx-video-viewer-wallet/releases/ynx-video-d75ad97040041b6febbf4e9ebdb338fdb4c1eff5 ]]
  [[ $(curl -fsS --max-time 10 http://127.0.0.1:6493/version | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).build.commit))') == "$source" ]]
  port=6494
  ;;
 *) exit 2;;
esac
[[ ! -e $release && ! -e $config ]]
[[ $(sha256sum "$artifact" | cut -d' ' -f1) == "$artifact_sha" ]]
[[ $(systemctl show "$unit" -p User --value) == ynx ]]
[[ $(systemctl is-active "$unit") == active ]]
old_pid=$(systemctl show "$unit" -p MainPID --value)
old_envfiles=$(systemctl show "$unit" -p EnvironmentFiles --value)
old_environment=$(systemctl show "$unit" -p Environment --value)
[[ $old_pid =~ ^[1-9][0-9]*$ ]]
snapshot() {
 systemctl show $neighbors -p Id -p MainPID -p ActiveState -p ExecMainStartTimestampMonotonic
 sha256sum /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy /etc/caddy/conf.d/ynx-video-products-20260906.caddy
 sha256sum /etc/systemd/system/ynx-creator-studio-wallet.service.d/20260906-v3-channel-id.conf
 readlink -f /opt/ynx-video/current
 curl -fsS --max-time 10 http://127.0.0.1:6495/creator-studio.manifest.json | sha256sum
}
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
 installed=1
 cat > "$config" <<EOF
[Service]
ExecStart=
ExecStart=$release/ynx-videod
EOF
else
 tar -xzf "$artifact" --strip-components=1 --no-same-owner -C "$release"
 chmod -R a+rX "$release"
 node - "$release" "$source" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2],source=process.argv[3];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime-manifest.json')));
if(manifest.sourceCommit!==source)throw Error('Source manifest mismatch');
for(const [name,item]of Object.entries(manifest.files)){const bytes=fs.readFileSync(path.join(root,name));if(bytes.length!==item.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Runtime manifest mismatch: '+name);}
console.log('VIEWER_MANIFEST_FILES_VERIFIED='+Object.keys(manifest.files).length);
JS
 sudo -u ynx test -r "$release/server.mjs"
 sudo -u ynx /usr/bin/node --check "$release/server.mjs"
 installed=1
 cat > "$config" <<EOF
[Service]
WorkingDirectory=$release
ExecStart=
ExecStart=/usr/bin/node $release/server.mjs
EOF
fi
chmod 0644 "$config"
systemctl daemon-reload
systemd-analyze verify "$unit"
[[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$old_envfiles" ]]
[[ $(systemctl show "$unit" -p Environment --value) == "$old_environment" ]]
[[ $(snapshot) == "$before_neighbors" ]]
restarted=1
systemctl restart "$unit"
for attempt in {1..30}; do
 if [[ $mode == api ]]; then probe=http://127.0.0.1:$port/health; else probe=http://127.0.0.1:$port/; fi
 if curl -fsS --max-time 2 "$probe" >/dev/null 2>&1; then break; fi
 sleep 0.2
done
[[ $(systemctl is-active "$unit") == active ]]
[[ $(snapshot) == "$before_neighbors" ]]
if [[ $mode == api ]]; then
 curl -fsS --max-time 10 http://127.0.0.1:6493/version | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s);if(v.build.commit!=="48fe3824cc6a38ba944427776e48d076f27f54f5")process.exit(1);console.log(JSON.stringify(v));})'
 curl -fsS --max-time 10 http://127.0.0.1:6493/health
 curl -fsS --max-time 10 http://127.0.0.1:6493/v1/videos
 [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:6493/v1/playlists) == 401 ]]
 [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -H 'X-YNX-Product-Session-Proof-V2: invalid' -H 'Origin: https://video.ynxweb4.com' http://127.0.0.1:6493/v1/playlists) == 401 ]]
 echo MISSING_AND_INVALID_PROOFS_REJECTED=true
 new_pid=$(systemctl show "$unit" -p MainPID --value)
 [[ $(sha256sum "/proc/$new_pid/exe" | cut -d' ' -f1) == "$artifact_sha" ]]
else
 curl -fsS --max-time 10 http://127.0.0.1:6494/runtime-manifest.json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s);if(v.sourceCommit!=="48fe3824cc6a38ba944427776e48d076f27f54f5")process.exit(1);console.log("VIEWER_RUNTIME_SOURCE="+v.sourceCommit);})'
 for path in wallet-auth/callback wallet-callback.js callback.css product-session.js product-session-sdk.js product-session-registry.json video-api.js watch-progress.js video/api/health; do curl -fsS --max-time 10 "http://127.0.0.1:6494/$path" >/dev/null; done
 [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:6494/.qa-private/testnet-owned-demo-20260906.json) == 404 ]]
 [[ $(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:6494/package.json) == 404 ]]
fi
trap - ERR
printf '\nNEIGHBORS_AFTER\n%s\n' "$(snapshot)"
systemctl show "$unit" -p Id -p MainPID -p ActiveState -p ExecStart -p WorkingDirectory -p EnvironmentFiles -p DropInPaths -p NRestarts
sha256sum "$config"
date -u '+COMPLETED_AT=%Y-%m-%dT%H:%M:%SZ'
echo LIBRARY_V2_DEPLOYED=true
