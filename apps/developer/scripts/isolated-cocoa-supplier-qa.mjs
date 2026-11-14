import {readFile,lstat,realpath,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname,join} from 'node:path';
import {ownedUndefinedSymbols} from './native-macos-link-plan.mjs';
const exec=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const fixed='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-cocoa-isolated-qa-successor-20261101/HANDOFF.json';
const tmpfix='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-cocoa-isolated-qa-successor-20261101-tmpfix/HANDOFF.json';
const profiles=new Map([[fixed,{bytes:2796,sha256:'bfe94b55cabc0f988c5c15c370914e06b237e26d4ea534107a3e3d63ec7f2439',suffix:'',execute:false}],[tmpfix,{bytes:3473,sha256:'81d8ef6c1b1b47650adc81b4fc4b84d631c9ed27413bd6a34ec3bae25a99999c',suffix:'-tmpfix',execute:true}]]);
async function pinned(row){const s=await lstat(row.path);if(!s.isFile()||s.isSymbolicLink()||await realpath(row.path)!==row.path||s.size!==row.bytes)throw Error('Isolated supplier input identity changed');const b=await readFile(row.path);if(sha(b)!==row.sha256)throw Error('Isolated supplier pin changed');return b;}
export function assertIsolatedQAProfile(m,s,suffix=''){
 if(!['','-tmpfix'].includes(suffix)||m.kind!=='SDK49_P03_ORDINARY_ISOLATED_COCOA_QA_NOT_R2/v1'||m.R2!==false||m.objectCount!==36||m.sourceCount!==373||m.strictUndefinedError!==true||m.formalBuildOwner!=='Original A only'||s.commit!=='742e00be6058312088afe80e30210dab76d15052'||s.tree!=='d58dbadf683f25f718feef827dbc3ffd627bd02b'||s.files.length!==373||m.qaOutputRoot!=='/REDACTED_VOLUME/YNX-large-work/coordination-v5-20261031/owners/P03/qa-builds/sdk49-cocoa-isolated-base-qa-20261101'+suffix)throw Error('This is not the fixed ordinary base QA profile; no product/R2 substitution.');
 if(suffix==='-tmpfix'&&(m.temporaryEnvironment?.TMPDIR!=='/tmp/ynx-ide-cocoa-q2'||m.temporaryEnvironment.target!==m.qaOutputRoot+'/temp'||m.temporaryEnvironment.cacheRoot!==m.qaOutputRoot+'/cache'||m.temporaryEnvironment.owner!==process.getuid()))throw Error('Controlled temporary environment changed');
}
/** Separate explicit normal CLI branch. Never swaps the formal App recipe,
 * binary, SDK8ed prefix or current product source to this historical base. */
export async function runIsolatedCocoaSupplierQA(handoff,mode){
 const profile=profiles.get(handoff);if(!profile||!['--plan','--execute'].includes(mode))throw Error('Use the exact isolated supplier handoff and mode');
 if(mode==='--execute'&&!profile.execute)throw Error('Retained first-failure profile is readback-only; use the exact permitted successor');
 const h=JSON.parse(await pinned({path:handoff,bytes:profile.bytes,sha256:profile.sha256}));
 for(const key of ['functionResult','normalQAExecutionData','sourceFiles','sourceBundle','runner','planReadback','R2Gaps'])await pinned(h[key]);
 if(profile.suffix){await pinned(h.previousImmutableH);await pinned(h.CLIWriterDelta);}
 const m=JSON.parse(await readFile(h.normalQAExecutionData.path)),s=JSON.parse(await readFile(h.sourceFiles.path));assertIsolatedQAProfile(m,s,profile.suffix);
 for(const row of s.files)await pinned(row);
 if(mode==='--execute')try{await lstat(m.qaOutputRoot);throw Error('Prior isolated execution exists; reconcile it, never overwrite or replay.');}catch(error){if(error.code!=='ENOENT')throw error;}
 // The supplier independently checks all source/Git/argv pins before running.
 const result=await exec(process.execPath,[h.runner.path,mode],{cwd:dirname(h.runner.path),timeout:900000,maxBuffer:2*1024*1024});
 if(mode==='--execute'){
  const nm=await exec('/usr/bin/nm',['-u',m.binary],{maxBuffer:2*1024*1024}),ownedUndefined=ownedUndefinedSymbols(nm.stdout);
  await writeFile(join(m.qaOutputRoot,'P03_UNDEFINED_READBACK.json'),JSON.stringify({sourceCommit:s.commit,binarySHA256:sha(await readFile(m.binary)),undefinedOutput:nm.stdout,ownedUndefined,formalBuild:false,R2:false,currentProductPackage:false},null,2)+'\n',{flag:'wx',mode:0o600});
  if(ownedUndefined.length)throw Error('Owned symbols remain undefined in isolated base QA');
 }
 return {supplierOutput:result.stdout,formalBuild:false,R2:false,currentProductPackage:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false};
}
