#!/usr/bin/env bash
# One selected frontend only. Coordinator executes; no API/Auth/Caddy/data changes.
set -Eeuo pipefail
[[ $EUID == 0 ]]
mode=viewer
action=${1:-deploy}
source=91bad5347d4fa8ef17ca7ce962ad7d0d1d6cb810
sdk_source=ff68d6d1c81708bd0144016750002a87d50bb5f9
sdk_sha=dbbd61d824646c989e875eda8b620400b46ed4fdf36e98e8f3a507578ed31329
case "$mode" in
 viewer)
  unit=ynx-video-viewer.service
  artifact=/var/tmp/ynx-video-91bad5347-runtime.tar.gz
  artifact_sha=843cd1df9a1dd625c93ed1e9a4a617ba362e14723e9c5d4c0124f87f24db1c31
  release=/opt/ynx-video-viewer-wallet/releases/ynx-video-$source
  old_release=/opt/ynx-video-viewer-wallet/releases/ynx-video-b6af671d04a4230bb7a4052cee1ff21d2f5c9c51
  old_dropins="/etc/systemd/system/$unit.d/20260906-audit.conf /etc/systemd/system/$unit.d/20260906-library-v2.conf /etc/systemd/system/$unit.d/20260906-wallet-time-ff68.conf"
  old_config=/etc/systemd/system/$unit.d/20260906-wallet-time-ff68.conf
  old_config_sha=174d92913a10baeeaf6fbff59058fb06f9edcc939feeb6c4d9d1b1f354b8f55c
  manifest=runtime-manifest.json
  neighbors=(ynx-videod.service ynx-creator-studio-wallet.service ynx-wallet-gateway.service)
  neighbor_manifest=http://127.0.0.1:6495/creator-studio.manifest.json
  port=6494
  ;;
 *) exit 2;;
esac
config=/etc/systemd/system/$unit.d/20260906-z-guest-navigation-91bad.conf
config_text=$(printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=/usr/bin/node %s/server.mjs\n' "$release" "$release")
config_sha=$(printf '%s\n' "$config_text" | sha256sum | cut -d' ' -f1)
[[ $action == deploy || $action == rollback ]]
[[ $(sha256sum "$old_config" | cut -d' ' -f1) == "$old_config_sha" ]]
[[ $(systemctl show "$unit" -p User --value) == ynx ]]
[[ $(systemctl is-active "$unit") == active ]]
old_environment=$(systemctl show "$unit" -p Environment --value)
old_envfiles=$(systemctl show "$unit" -p EnvironmentFiles --value)
snapshot() {
 systemctl show "${neighbors[@]}" -p Id -p MainPID -p ActiveState -p ExecMainStartTimestampMonotonic
 sha256sum /etc/caddy/Caddyfile /etc/caddy/ynx-chain.caddy /etc/caddy/conf.d/ynx-video-products-20260906.caddy
 readlink -f /opt/ynx-video/current
 curl -fsS --max-time 10 http://127.0.0.1:6493/version | sha256sum
 curl -fsS --max-time 10 "$neighbor_manifest" | sha256sum
}
before=$(snapshot)
printf 'MODE=%s\nACTION=%s\nSOURCE=%s\nARTIFACT_SHA256=%s\nNEIGHBORS_BEFORE\n%s\n' "$mode" "$action" "$source" "$artifact_sha" "$before"
restore_predecessor() {
 [[ $(sha256sum "$config" | cut -d' ' -f1) == "$config_sha" ]]
 rm -- "$config"
 systemctl daemon-reload
 systemctl restart "$unit"
 [[ $(systemctl show "$unit" -p WorkingDirectory --value) == "$old_release" ]]
 [[ $(systemctl show "$unit" -p DropInPaths --value) == "$old_dropins" ]]
 [[ $(systemctl is-active "$unit") == active ]]
 [[ $(systemctl show "$unit" -p Environment --value) == "$old_environment" ]]
 [[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$old_envfiles" ]]
 [[ $(snapshot) == "$before" ]]
}
if [[ $action == rollback ]]; then
 [[ $(systemctl show "$unit" -p WorkingDirectory --value) == "$release" ]]
 restore_predecessor
 echo SELECTED_FRONTEND_ROLLBACK_CONFIRMED=true
 exit 0
fi
[[ ! -e $release && ! -e $config ]]
[[ $(sha256sum "$artifact" | cut -d' ' -f1) == "$artifact_sha" ]]
[[ $(systemctl show "$unit" -p WorkingDirectory --value) == "$old_release" ]]
[[ $(systemctl show "$unit" -p DropInPaths --value) == "$old_dropins" ]]
curl -fsS --max-time 10 -H x-request-id:req_creator_wallet_time_preflight http://127.0.0.1:18445/v2/product-sessions/time |
 node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const x=JSON.parse(s);if(x.ok!==true||!Number.isFinite(Date.parse(x.result.serverTime)))process.exit(1);console.log("AUTHORITY_TIME_ENDPOINT_CONFIRMED=true")})'
installed=0
recover() {
 local code=$?
 trap - ERR
 if [[ $installed == 1 ]]; then restore_predecessor; fi
 printf 'FAILED_EXIT=%s\nONLY_SELECTED_FRONTEND_DROPIN_TOUCHED=true\n' "$code"
 exit "$code"
}
trap recover ERR
install -d -m0755 "$release" "$(dirname "$config")"
if [[ $mode == viewer ]]; then
 tar -xzf "$artifact" -C "$release" --strip-components=1 --no-same-owner
else
 tar -xzf "$artifact" -C "$release" --no-same-owner
fi
chmod -R a+rX "$release"
node - "$release" "$source" "$manifest" "$sdk_source" "$sdk_sha" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [root,source,name,sdkSource,sdkSHA]=process.argv.slice(2);
const manifest=JSON.parse(fs.readFileSync(path.join(root,name)));
if(manifest.sourceCommit!==source)throw Error('Frontend source mismatch');
const files=Array.isArray(manifest.files)?manifest.files:Object.entries(manifest.files).map(([path,v])=>({path,...v}));
for(const item of files){if(item.path.includes('..')||path.isAbsolute(item.path))throw Error('Invalid manifest path');const bytes=fs.readFileSync(path.join(root,item.path));if(bytes.length!==item.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Runtime mismatch: '+item.path);}
const sdk=JSON.parse(fs.readFileSync(path.join(root,'product-session-sdk-source.json')));
if(sdk.sdkSourceCommit!==sdkSource||sdk.files.find(f=>f.path==='product-session-sdk.js')?.sha256!==sdkSHA)throw Error('Wallet SDK mismatch');
console.log('MANIFEST_FILES_VERIFIED='+files.length);
JS
sudo -u ynx test -r "$release/server.mjs"
sudo -u ynx node --check "$release/app.js"
printf '%s\n' "$config_text" > "$config"
installed=1
chmod 0644 "$config"
systemctl daemon-reload
systemd-analyze verify "$unit"
[[ $(systemctl show "$unit" -p Environment --value) == "$old_environment" ]]
[[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$old_envfiles" ]]
[[ $(snapshot) == "$before" ]]
systemctl restart "$unit"
for attempt in {1..30}; do
 if curl -fsS --max-time 2 "http://127.0.0.1:$port/$manifest" >/dev/null 2>&1; then break; fi
 sleep 0.2
done
[[ $(systemctl is-active "$unit") == active ]]
[[ $(snapshot) == "$before" ]]
curl -fsS --max-time 10 "http://127.0.0.1:$port/$manifest" |
 node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(JSON.parse(s).sourceCommit!==process.argv[1])process.exit(1)})' "$source"
for file in app.js product-session.js product-session-sdk.js product-session-sdk-source.json product-session-registry.json wallet-callback.js styles.css; do
 [[ $(curl -fsS --max-time 10 "http://127.0.0.1:$port/$file" | sha256sum | cut -d' ' -f1) == $(sha256sum "$release/$file" | cut -d' ' -f1) ]]
done
for path in wallet-auth/callback callback.css video/api/health; do curl -fsS --max-time 10 "http://127.0.0.1:$port/$path" >/dev/null; done
trap - ERR
printf '\nNEIGHBORS_AFTER\n%s\n' "$(snapshot)"
systemctl show "$unit" -p Id -p MainPID -p ActiveState -p WorkingDirectory -p ExecStart -p DropInPaths -p NRestarts
sha256sum "$config"
date -u '+COMPLETED_AT=%Y-%m-%dT%H:%M:%SZ'
echo VIEWER_GUEST_NAVIGATION_DEPLOYED=true
