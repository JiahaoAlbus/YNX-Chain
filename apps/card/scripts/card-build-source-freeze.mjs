import {execFileSync} from 'node:child_process';

const generatedPrefixes=['evidence/','release/','dist-web/','deployment-envelope/','node_modules/','.expo/','coverage/'];
function ownedPath(path){
  if(typeof path!=='string'||!path.startsWith('apps/card/'))throw new Error('CARD_BUILD_SOURCE_PATH_INVALID');
  return path.slice('apps/card/'.length);
}

export function assertFrozenCardBuildInputs({trackedChanges,untrackedPaths}){
  if(!Array.isArray(trackedChanges)||!Array.isArray(untrackedPaths))throw new Error('CARD_BUILD_SOURCE_STATUS_INVALID');
  for(const path of trackedChanges)ownedPath(path);
  if(trackedChanges.length)throw new Error('CARD_BUILD_TRACKED_SOURCE_DIRTY');
  for(const path of untrackedPaths){
    const relative=ownedPath(path);
    if(!generatedPrefixes.some(prefix=>relative.startsWith(prefix)))throw new Error('CARD_BUILD_UNTRACKED_PRODUCT_INPUT');
  }
}

export function verifyCardBuildSourceFreeze(root){
  const paths=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  assertFrozenCardBuildInputs({
    trackedChanges:paths(['diff','--name-only','-z','HEAD','--','.']),
    untrackedPaths:paths(['ls-files','--others','--exclude-standard','--full-name','-z','--','.']),
  });
}
