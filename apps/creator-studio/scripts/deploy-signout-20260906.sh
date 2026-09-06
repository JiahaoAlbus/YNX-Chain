#!/usr/bin/env bash
# Creator6495 only; restore298 by removing only this new drop-in on failure.
set -Eeuo pipefail
[[ $EUID == 0 ]]
unit=ynx-creator-studio-wallet.service
source=e6a5c98ff9a60c4e76cb6879e72f5801c556a9d1
artifact=/var/tmp/ynx-creator-e6a5c98ff-runtime.tar.gz
artifact_sha=3db22bb88c1ad166ec526ab193bbcb69e0d462997d0fd5d8322bde1a85132ab9
release=/opt/ynx-creator-studio-wallet/releases/audit-signout-$source
config=/etc/systemd/system/$unit.d/20260906-v4-signout.conf
[[ ! -e $release && ! -e $config ]]
[[ $(sha256sum "$artifact" | cut -d' ' -f1) == "$artifact_sha" ]]
[[ $(systemctl show "$unit" -p User --value) == ynx ]]
[[ $(systemctl is-active "$unit") == active ]]
[[ $(systemctl show "$unit" -p WorkingDirectory --value) == /opt/ynx-creator-studio-wallet/releases/audit-v2-29896f10c5e59fc17590dd3697d6e7af3d34a809 ]]
[[ $(systemctl show "$unit" -p DropInPaths --value) == "/etc/systemd/system/$unit.d/20260906-v2-consumer.conf /etc/systemd/system/$unit.d/20260906-v3-channel-id.conf" ]]
[[ $(sha256sum /etc/systemd/system/$unit.d/20260906-v3-channel-id.conf | cut -d' ' -f1) == 34d6fe89ec14b9941ea567072f992b5f903b90222a390f57244a3022d9ed57e2 ]]
old_environment=$(systemctl show "$unit" -p Environment --value)
old_envfiles=$(systemctl show "$unit" -p EnvironmentFiles --value)
snapshot() {
 systemctl show ynx-videod.service ynx-video-viewer.service ynx-wallet-gateway.service -p Id -p MainPID -p ActiveState -p ExecMainStartTimestampMonotonic
 sha256sum /etc/caddy/Caddyfile /etc/caddy/conf.d/ynx-video-products-20260906.caddy
 readlink -f /opt/ynx-video/current
 curl -fsS --max-time 10 http://127.0.0.1:6493/version | sha256sum
 curl -fsS --max-time 10 http://127.0.0.1:6494/runtime-manifest.json | sha256sum
}
before=$(snapshot)
printf 'SOURCE=%s\nARTIFACT_SHA256=%s\nNEIGHBORS_BEFORE\n%s\n' "$source" "$artifact_sha" "$before"
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
 printf 'CREATOR298_ROLLBACK_ONLY=true\nFAILED_EXIT=%s\n' "$code"
 systemctl show "$unit" -p Id -p ActiveState -p MainPID -p WorkingDirectory -p DropInPaths
 exit "$code"
}
trap recover ERR
install -d -m0755 "$release" "$(dirname "$config")"
tar -xzf "$artifact" -C "$release" --no-same-owner
chmod -R a+rX "$release"
node - "$release" "$source" <<'JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2],source=process.argv[3],manifest=JSON.parse(fs.readFileSync(path.join(root,'creator-studio.manifest.json')));
if(manifest.sourceCommit!==source)throw Error('Creator source mismatch');
for(const item of manifest.files){const bytes=fs.readFileSync(path.join(root,item.path));if(bytes.length!==item.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Creator runtime mismatch');}
console.log('MANIFEST_FILES_VERIFIED='+manifest.files.length);
JS
sudo -u ynx test -r "$release/server.mjs"
sudo -u ynx node --check "$release/app.js"
installed=1
cat > "$config" <<EOF
[Service]
WorkingDirectory=$release
ExecStart=
ExecStart=/usr/bin/node $release/server.mjs
EOF
chmod 0644 "$config"
systemctl daemon-reload
systemd-analyze verify "$unit"
[[ $(systemctl show "$unit" -p Environment --value) == "$old_environment" ]]
[[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$old_envfiles" ]]
[[ $(snapshot) == "$before" ]]
restarted=1
systemctl restart "$unit"
for attempt in {1..30}; do
 if curl -fsS --max-time 2 http://127.0.0.1:6495/creator-studio.manifest.json >/dev/null 2>&1; then break; fi
 sleep 0.2
done
[[ $(systemctl is-active "$unit") == active ]]
[[ $(snapshot) == "$before" ]]
curl -fsS --max-time 10 http://127.0.0.1:6495/creator-studio.manifest.json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s);if(v.sourceCommit!=="e6a5c98ff9a60c4e76cb6879e72f5801c556a9d1")process.exit(1);console.log("CREATOR_SOURCE="+v.sourceCommit);})'
[[ $(curl -fsS --max-time 10 http://127.0.0.1:6495/app.js | sha256sum | cut -d' ' -f1) == 41bffdffd8ee55477fda48cb8332461d5abaf55eff6dac7e68666c9c53f89ea1 ]]
for path in wallet-auth/callback wallet-callback.js callback.css product-session.js product-session-sdk.js product-session-registry.json video/api/health; do curl -fsS --max-time 10 "http://127.0.0.1:6495/$path" >/dev/null; done
trap - ERR
printf '\nNEIGHBORS_AFTER\n%s\n' "$(snapshot)"
systemctl show "$unit" -p Id -p MainPID -p ActiveState -p WorkingDirectory -p ExecStart -p DropInPaths -p NRestarts
sha256sum "$config"
date -u '+COMPLETED_AT=%Y-%m-%dT%H:%M:%SZ'
echo CREATOR_SIGNOUT_PATCH_DEPLOYED=true
