#!/bin/bash
set -euo pipefail
export LC_ALL=C

tuple() {
  /usr/bin/stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$1"
}

inspect_path() {
  local label="$1" target="$2"
  if [[ ! -e "$target" && ! -L "$target" ]]; then
    echo "PATH_${label}=absent"
    return
  fi
  echo "PATH_${label}=present"
  echo "TUPLE_${label}=$(tuple "$target")"
  if [[ -L "$target" ]]; then
    echo "TARGET_${label}=$(/usr/bin/readlink -- "$target")"
  elif [[ -f "$target" ]]; then
    echo "SHA256_${label}=$(/usr/bin/sha256sum -- "$target" | /usr/bin/cut -d' ' -f1)"
  elif [[ -d "$target" ]]; then
    while IFS= read -r -d '' child; do
      relative="${child#"$target"/}"
      [[ "$child" == "$target" ]] && relative='.'
      echo "TREE_${label}_PATH=$relative"
      echo "TREE_${label}_TUPLE=$(tuple "$child")"
      if [[ -L "$child" ]]; then
        echo "TREE_${label}_TARGET=$(/usr/bin/readlink -- "$child")"
      elif [[ -f "$child" ]]; then
        echo "TREE_${label}_SHA256=$(/usr/bin/sha256sum -- "$child" | /usr/bin/cut -d' ' -f1)"
      fi
    done < <(/usr/bin/find -P "$target" -print0 | /usr/bin/sort -z)
  fi
}

echo 'inspection=CREATOR_P0315_TERMINAL_ZERO_WRITE_READBACK'
inspect_path current /opt/ynx-creator-studio-wallet/current
inspect_path current_next /opt/ynx-creator-studio-wallet/current.next-3f97a13d
inspect_path receipt /opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json
inspect_path receipt_next /opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json.next
inspect_path candidate /opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d
inspect_path candidate_stage /opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d.next
inspect_path candidate_quarantine_pre /opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d.cleanup-pre-switch
inspect_path candidate_quarantine_post /opt/ynx-creator-studio-wallet/releases/creator-studio-3f97a13d.cleanup-post-switch
inspect_path control /opt/ynx-release-control-plane/creator-studio-3f97a13d
inspect_path control_stage /opt/ynx-release-control-plane/creator-studio-3f97a13d.next
inspect_path control_quarantine /opt/ynx-release-control-plane/creator-studio-3f97a13d.cleanup-pre-switch
inspect_path unit /etc/systemd/system/ynx-creator-studio-wallet.service

receipt=/opt/ynx-creator-studio-wallet/receipts/upgrade-3f97a13d.json
if [[ -f "$receipt" && ! -L "$receipt" ]]; then
  echo "RECEIPT_BYTES=$(/usr/bin/stat -c %s -- "$receipt")"
  echo "RECEIPT_SHA256=$(/usr/bin/sha256sum -- "$receipt" | /usr/bin/cut -d' ' -f1)"
  if /usr/bin/node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))' "$receipt"; then
    echo 'RECEIPT_JSON_PARSE=valid'
    echo "RECEIPT_JSON_BASE64=$(/usr/bin/base64 -w0 -- "$receipt")"
  else
    echo 'RECEIPT_JSON_PARSE=invalid'
    echo "RECEIPT_RAW_BASE64=$(/usr/bin/base64 -w0 -- "$receipt")"
  fi
fi

for service in ynx-creator-studio-wallet.service ynx-video-viewer.service ynx-videod.service; do
  echo "SERVICE_${service}=$(/usr/bin/systemctl show "$service" -p LoadState -p ActiveState -p SubState -p MainPID -p NRestarts --value | /usr/bin/tr '\n' ':')"
done
for port in 6493 6494 6495; do
  echo "LISTENER_${port}=$(/usr/bin/ss -H -ltnp "sport = :$port")"
done

node_http='const https=require("node:https"),crypto=require("node:crypto");const [url,label]=process.argv.slice(1);https.get(url,{headers:{"cache-control":"no-cache","pragma":"no-cache"}},r=>{const a=[];r.on("data",x=>a.push(x));r.on("end",()=>{const b=Buffer.concat(a);console.log(`HTTP_${label}_STATUS=${r.statusCode}`);console.log(`HTTP_${label}_BYTES=${b.length}`);console.log(`HTTP_${label}_SHA256=${crypto.createHash("sha256").update(b).digest("hex")}`);console.log(`HTTP_${label}_CONTENT_TYPE=${r.headers["content-type"]||""}`);console.log(`HTTP_${label}_CACHE_CONTROL=${r.headers["cache-control"]||""}`);});}).on("error",e=>{console.log(`HTTP_${label}_ERROR=${e.code||e.message}`);process.exitCode=1;});'
/usr/bin/node -e "$node_http" https://web4.ynxweb4.com/video/studio/ root
/usr/bin/node -e "$node_http" https://web4.ynxweb4.com/video/studio/app.js app_js
/usr/bin/node -e "$node_http" https://web4.ynxweb4.com/video/studio/creator-studio.manifest.json manifest
/usr/bin/node -e "$node_http" https://web4.ynxweb4.com/video/studio/i18n.js i18n
/usr/bin/node -e "$node_http" https://web4.ynxweb4.com/video/studio/i18n/catalog.json catalog

echo 'inspectionComplete=true'
echo 'mutationCount=0'
