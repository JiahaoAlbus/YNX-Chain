import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const hardhatArtifactsPath='./artifacts/hardhat';
const namespace=hardhatArtifactsPath.slice(2);
const markerName='.ynx-hardhat-output.json';
const markerValue={schema:'ynx-hardhat-output/v1',namespace};
function tracked(root,relative){return execFileSync('git',['-C',root,'ls-files','-z','--',relative],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).split('\0').filter(Boolean);}
function info(p){try{return fs.lstatSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function regularDirectory(p){const s=info(p);if(s&&(!s.isDirectory()||s.isSymbolicLink()))throw Error('Hardhat output requires an owned regular directory: '+p);}

// Hardhat owns and may remove its complete artifacts directory. Never give it
// the shared artifacts root, tracked evidence, a link, or an unclaimed directory.
export function prepareHardhatOutput(root=process.cwd()){
 root=path.resolve(root);const base=path.join(root,'artifacts'),managed=path.join(root,namespace),marker=path.join(base,markerName);
 regularDirectory(base);regularDirectory(managed);
 if(tracked(root,namespace).length)throw Error('tracked inputs inside managed Hardhat output; refusing build');
 fs.mkdirSync(base,{recursive:true,mode:0o700});
 const m=info(marker);
 if(m){
  if(!m.isFile()||m.isSymbolicLink()||JSON.stringify(JSON.parse(fs.readFileSync(marker,'utf8')))!==JSON.stringify(markerValue))throw Error('Hardhat output ownership marker differs');
 }else{
  if(info(managed))throw Error('existing Hardhat output is unclaimed; refusing to clean it');
  fs.writeFileSync(marker,JSON.stringify(markerValue)+'\n',{flag:'wx',mode:0o600});
 }
 return {root,base,managed};
}

function treeContents(directory){
 const rows=[];
 function walk(dir,relative=''){
  for(const name of fs.readdirSync(dir).sort()){
   const p=path.join(dir,name),key=path.join(relative,name),s=fs.lstatSync(p);
   if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw Error('artifact output contains an uncontrolled link or special input: '+p);
   if(s.isDirectory()){rows.push(['directory',key]);walk(p,key);}
   else rows.push(['file',key,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]);
  }
 }
 walk(directory);return JSON.stringify(rows);
}

// Keep original real directories: Go filepath.WalkDir does not traverse a root
// symlink. Copy only the declared compiler outputs, retain prior bytes outside
// the compiler namespace, and never move or replace controlled source inputs.
export function finishHardhatOutput(root=process.cwd()){
 const {base,managed}=prepareHardhatOutput(root);root=path.resolve(root);
 const entries=['contracts','build-info'].map(name=>({name,target:path.join(managed,name),destination:path.join(base,name)}));
 for(const e of entries){
  regularDirectory(e.target);if(!info(e.target))throw Error('successful Hardhat output missing: '+e.name);
  const expected=treeContents(e.target);regularDirectory(e.destination);
  if(tracked(root,'artifacts/'+e.name).length)throw Error('refusing to replace controlled artifact input: '+e.destination);
  e.done=!!info(e.destination)&&treeContents(e.destination)===expected;
 }
 const backups=[];
 for(const e of entries){
  if(e.done)continue;
  const temp=fs.mkdtempSync(path.join(base,'.'+e.name+'-publish-'));let backup;
  try{
   fs.cpSync(e.target,temp,{recursive:true,errorOnExist:true,force:false});
   if(treeContents(temp)!==treeContents(e.target))throw Error('copied artifact output differs');
   if(info(e.destination)){
    regularDirectory(path.join(root,'cache'));const savedBase=path.join(root,'cache','hardhat-retained-artifacts');regularDirectory(savedBase);fs.mkdirSync(savedBase,{recursive:true,mode:0o700});
    const saved=fs.mkdtempSync(path.join(savedBase,'build-'));backup=path.join(saved,e.name);fs.renameSync(e.destination,backup);backups.push(backup);
   }
   fs.renameSync(temp,e.destination);
  }catch(err){
   if(backup&&!info(e.destination))fs.renameSync(backup,e.destination);
   throw err;
  }finally{if(info(temp))fs.rmSync(temp,{recursive:true});}
 }
 return {managedArtifacts:namespace,compatibilityDirectories:entries.map(e=>path.relative(root,e.destination)),retainedPreviousDirectories:backups.map(p=>path.relative(root,p))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 if(mode==='prepare'){prepareHardhatOutput();console.log('Hardhat output namespace verified; shared artifacts remain outside compiler cleanup');}
 else if(mode==='finish')console.log(JSON.stringify(finishHardhatOutput()));
 else throw Error('usage: hardhat-output.mjs prepare|finish');
}
