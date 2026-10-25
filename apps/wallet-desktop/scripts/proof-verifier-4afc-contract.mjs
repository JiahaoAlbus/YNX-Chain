import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
const fail=()=>{throw Error('WALLET_4AFC_ORIGINAL_SIGN_STAGE_DIFFERS');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=bytes=>({bytes:bytes.length,sha256:hash(bytes)});
export const ORIGINAL_4AFC_VERIFIER=Object.freeze({
 sourceCommit:'4afc29656ee0f60c6eda9ae62387e6797552aa3e',forkTree:'fa760970088d4f1a275d4cab254d63a014db9c74',
 ciOriginal:Object.freeze({bytes:35142322,sha256:'4f10ae461745387013d2dc154cb7c808db9ec60ecb4dde96fbf17e4599db7f41'}),
 sourceFile:Object.freeze({bytes:1938,sha256:'f0fa40ee4de42185519629c19c5fd42e716547d424cbb21ac55cd02361f94b6a'}),
 selectionSourceFile:Object.freeze({bytes:2049,sha256:'667e98589654e705dd0292d8833b2a1a1c9438ee44782d99226801a1f5570b86'}),
});
function pinned(bytes,p){if(!Buffer.isBuffer(bytes)||bytes.length!==p.bytes||hash(bytes)!==p.sha256)fail();return bytes;}
function arm64(bytes){if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.length>(64<<20)||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x0100000c)fail();}
// Original A calls this BEFORE its existing normal inner-sign step and retains
// the actual copy/sign/verify process evidence. No ENV, download, signer,
// provider, Source/current, registration or key operation is supplied here.
export function verifyOriginal4afcCISupply({binaryBytes,sourceBytes,selectionSourceBytes}){
 pinned(binaryBytes,ORIGINAL_4AFC_VERIFIER.ciOriginal);pinned(sourceBytes,ORIGINAL_4AFC_VERIFIER.sourceFile);pinned(selectionSourceBytes,ORIGINAL_4AFC_VERIFIER.selectionSourceFile);arm64(binaryBytes);
 const s=JSON.parse(sourceBytes),selection=JSON.parse(selectionSourceBytes);
 if(s.commit!==ORIGINAL_4AFC_VERIFIER.sourceCommit||s.cometForkTree!==ORIGINAL_4AFC_VERIFIER.forkTree||selection.commit!==s.commit||selection.sourceTree!=='151f2c47a65cb2d325f8e62f48f469b8a59575e2'||s.executedOnMacOS!==false||s.crossCompiled!==true||s.nativeRootAuthorized!==false)fail();
 return Object.freeze({sourceCommit:s.commit,rawCIExact:true,artifactExecuted:false,Source:false,Root:false,installed:false});
}
// Build DATA only. A's normal signer supplies the actual post-inner-sign copy;
// this function COMPUTES pins, never accepts a hand-filled SHA or edits gates.
// Main independently rechecks A's frozen receipt and stage before freezing its
// runtime profile. The Resources manifest NEVER qualifies itself at runtime.
export function createOriginal4afcManifestBytes(bundledBytes){
 arm64(bundledBytes);return Buffer.from(JSON.stringify({schema:'YNX-WALLET-PACKAGED-PROOF-VERIFIER/v1',sourceCommit:ORIGINAL_4AFC_VERIFIER.sourceCommit,forkTree:ORIGINAL_4AFC_VERIFIER.forkTree,platform:'darwin',architecture:'arm64',binaryPath:'darwin-arm64/ynx-consensus-proof-verify',ciOriginal:ORIGINAL_4AFC_VERIFIER.ciOriginal,bundled:pin(bundledBytes),sourceFile:{path:'SOURCE.json',...ORIGINAL_4AFC_VERIFIER.sourceFile},signingClass:'ADHOC_QA_NOT_CLEARED'},null,2)+'\n');
}
function regular(file,{executable=false}={}){
 if(!path.isAbsolute(file)||path.normalize(file)!==file||realpathSync(file)!==file)fail();const before=lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||(before.mode&0o022)||executable&&!(before.mode&0o111)||typeof process.getuid==='function'&&before.uid!==process.getuid())fail();
 const bytes=readFileSync(file),after=lstatSync(file);if(['dev','ino','size','mode','uid','nlink','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))fail();return bytes;
}
// Read-only independent receipt collector for the ORIGINAL A stage. It does
// not sign, copy, chmod, install, execute the verifier, register a Source or
// admit this new component to Main. A freezes its output plus actual signing
// evidence; Main then pins exactly those bytes in source through normal CAS.
export function inspectOriginal4afcPostInnerSignStage(resourcesStage){
 const root=path.join(resourcesStage,'consensus-proof-verifier'),binary=path.join(root,'darwin-arm64/ynx-consensus-proof-verify'),bundledBytes=regular(binary,{executable:true}),sourceBytes=regular(path.join(root,'SOURCE.json')),sidecar=regular(path.join(root,'HOST_SELECTION_SOURCE_GIT_PINS.json')),manifestBytes=regular(path.join(root,'manifest.json'));
 pinned(sourceBytes,ORIGINAL_4AFC_VERIFIER.sourceFile);pinned(sidecar,ORIGINAL_4AFC_VERIFIER.selectionSourceFile);if(!manifestBytes.equals(createOriginal4afcManifestBytes(bundledBytes)))fail();
 const args=['--verify','--strict',binary];execFileSync('/usr/bin/codesign',args,{stdio:'pipe'});
 const shown=spawnSync('/usr/bin/codesign',['--display','--verbose=4',binary],{encoding:'utf8',maxBuffer:1<<20});if(shown.error||shown.status!==0||shown.signal!==null||!/^Signature=adhoc$/m.test(shown.stderr??''))fail();
 // codesign display writes metadata on stderr; actual verify success above
 // is recorded, while signer/entitlement provenance stays A's original evidence.
 if(!isDeepStrictEqual(pin(regular(binary,{executable:true})),pin(bundledBytes)))fail();
 return Object.freeze({kind:'YNX_WALLET_4AFC_POST_INNER_SIGN_RECEIPT_DATA/v1',receipt:{sourceCommit:ORIGINAL_4AFC_VERIFIER.sourceCommit,forkTree:ORIGINAL_4AFC_VERIFIER.forkTree,manifest:pin(manifestBytes),bundled:pin(bundledBytes),sourceFile:pin(sourceBytes)},selectionSourceFile:pin(sidecar),normalCodeSignVerify:{tool:'/usr/bin/codesign',argv:args,exit:0,displayStdoutSHA256:hash(Buffer.from(shown.stdout??'')),displayStderrSHA256:hash(Buffer.from(shown.stderr??'')),adhoc:true},runtimeProfileAdmitted:false,artifactExecuted:false,notarized:false,Source:false,Root:false,installed:false});
}
