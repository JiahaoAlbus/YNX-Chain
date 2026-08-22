#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <state-path> <candidate-created-receipt> <stopped-receipt> <output-directory>" >&2
  exit 64
fi

state_path=$1
created_receipt=$2
stopped_receipt=$3
output_dir=$4

node - "$state_path" "$created_receipt" "$stopped_receipt" "$output_dir" <<'NODE'
const fs=require('fs'),path=require('path');
const [statePath,createdPath,stoppedPath,out]=process.argv.slice(2);
const created=JSON.parse(fs.readFileSync(createdPath,'utf8'));
const stopped=JSON.parse(fs.readFileSync(stoppedPath,'utf8'));
if(stopped.kind!=='candidate-stopped'||stopped.stopped!==true) process.exit(1);
const stat=fs.lstatSync(statePath);
if(String(stat.dev)!==String(created.device)||String(stat.ino)!==String(created.inode)) process.exit(1);
fs.unlinkSync(statePath);
fs.writeFileSync(path.join(out,'stopped-exact-inode-deletion.json'),JSON.stringify({schemaVersion:1,kind:'stopped-exact-inode-deletion',path:statePath,matchedDevice:String(stat.dev),matchedInode:String(stat.ino),deleted:true,observedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
if(fs.existsSync(statePath)) process.exit(1);
fs.writeFileSync(path.join(out,'final-absence.json'),JSON.stringify({schemaVersion:1,kind:'final-absence-before-old-service-restore',path:statePath,absent:true,observedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
NODE
