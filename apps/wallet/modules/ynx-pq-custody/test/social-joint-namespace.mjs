// macOS PUBLIC namespace controls. The original CI supplies its resource guard.
// This runner bounds each command and records failures; it grants no Source.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const started=performance.now();
const root=fileURLToPath(new URL('../',import.meta.url));
const prod=path.join(root,'native/social-joint-profile-issuer');
const matching=JSON.parse(fs.readFileSync(path.join(prod,'PRIVATE_PINS.json')));
const options={};
for(let i=2;i<process.argv.length;++i){
 const flag=process.argv[i];
 if(flag==='--check-configuration'){options.check=true;continue;}
 if(!['--main-header','--auth-header','--out-parent'].includes(flag)||!process.argv[i+1])throw Error('ARGUMENT:'+flag);
 options[flag]=process.argv[++i];
}
if(process.platform!=='darwin')throw Error('MACOS_CONTROL_LANE_REQUIRED; Linux not qualified');
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=p=>{const b=fs.readFileSync(p);return{path:p,bytes:b.length,sha256:sha(b)};};
const main=options['--main-header']??matching.mainCommittedSocialPair.frozenSource.find(p=>p.path.endsWith('social_main_committed_pair_private.h')).path;
const auth=options['--auth-header']??matching.issuerABI.path;
for(const[p,bytes,digest]of[[main,2153,'85088b5923f0d6c6df5ed98a3fe5ef3ed4f21f9a8c6fbc85b0c2524612bc3aa7'],[auth,7878,'e0134fc4c08933a4f195f4526375272635f4b4579f0a7d8fe74d03ee58b4afc3']]){
 const actual=pin(p);if(actual.bytes!==bytes||actual.sha256!==digest)throw Error('MATCHING_HEADER_DRIFT:'+p);
}
const parent=path.resolve(options['--out-parent']??os.tmpdir());
if(!fs.statSync(parent).isDirectory())throw Error('OUTPUT_PARENT_REQUIRED');
if(options.check){console.log(JSON.stringify({main,auth,parent,platform:'macOS',compile:false,Root:false}));process.exit(0);}
const stage=fs.mkdtempSync(path.join(parent,'social-joint-namespace-'));
const source=path.join(stage,'source');fs.mkdirSync(source);
const files=[path.join(prod,'CommittedSocial.cpp'),path.join(prod,'OriginalServices.hpp'),
 path.join(root,'test/social-joint-namespace.PUBLIC.cpp'),path.join(root,'test/social-joint-committed-social.PUBLIC.cpp'),fileURLToPath(import.meta.url),main,auth];
const inputs=files.map(pin),runs=[];
for(const p of inputs)fs.copyFileSync(p.path,path.join(source,path.basename(p.path)));
const save=(name,value)=>fs.writeFileSync(path.join(stage,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function run(name,exe,args){
 const remaining=30000-(performance.now()-started);
 if(remaining<=0)throw Error('CONTROL_WALL30');
 const r=spawnSync(exe,args,{encoding:'utf8',timeout:Math.min(10000,remaining),maxBuffer:1024**2,
  env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'}});
 fs.writeFileSync(path.join(stage,name+'.stdout'),r.stdout??'',{flag:'wx'});
 fs.writeFileSync(path.join(stage,name+'.stderr'),r.stderr??'',{flag:'wx'});
 runs.push({name,exe,args,pid:r.pid,exit:r.status,signal:r.signal,error:r.error?.message??null});
 if(r.status!==0||r.error)throw Error('COMMAND:'+name+':'+(r.error?.message??r.status));
}
let first=null;
try{
 run('compile','/usr/bin/clang++',['-std=c++17','-Wall','-Wextra','-Werror','-pthread',
  '-fsanitize=address,undefined','-fno-omit-frame-pointer','-DYNX_SOCIAL_JOINT_PUBLIC_CONTROLS',
  '-I'+source,path.join(source,'CommittedSocial.cpp'),path.join(source,'social-joint-namespace.PUBLIC.cpp'),'-o',path.join(stage,'PUBLIC')]);
 for(const mode of['namespace-success','namespace-foreign','view-late0','release-late0','release-unknown',
  'view0-untouched','namespace-post0','namespace-empty','private-span-foreign','namespace-actor','namespace-reentrant','namespace-detached'])
  run(mode,path.join(stage,'PUBLIC'),[mode]);
 for(const input of inputs){const actual=pin(input.path);if(actual.bytes!==input.bytes||actual.sha256!==input.sha256)throw Error('INPUT_POST_DRIFT:'+input.path);}
}catch(error){first=String(error);}
save('RESULT.json',{passed:first===null,first,inputs,runs,namespaceCases:runs.filter(r=>r.name!=='compile').length,
 actualCpp:true,PUBLICMainAndSourceSeams:true,ASANUBSAN:true,aggregateRSSCapNotClaimed:true,
 old26And39NotRerun:true,Root:false,DEVICEGrant:false,sign:false,normalImage:false,elapsedMs:performance.now()-started});
console.log(stage);
if(first)throw Error(first);
