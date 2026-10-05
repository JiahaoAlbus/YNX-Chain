import { readFile, writeFile, lstat, realpath, chmod, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const developer=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const common={
 'package.json':'f8b6a14f7022c14f1cd5d109486f5dacd32bffb63a9a63e38eced37dacb47439',
 'LICENSE':'a3d60eaf32d2fb09c9d82ef39f14bd6e2c0f3ca7de30daa827486c0d6f8b6e9f',
 'lib/index.js':'c1b82c92c4c63aaa8e8441fc5a291c4727cd3f3550666d2fec7250e0f6d4b173',
 'lib/unixTerminal.js':'a62e3a60c3bc1b0e7261f58284856df748dcee6761a2bc7a5a5ba98b22660473',
 'lib/utils.js':'f75ad341c13fbf1a9a6605d7ee42dff5bbc5d43b7b381e413fb97eb1b8300beb',
 'lib/terminal.js':'5ed5cd66a766afba4a04093284e999f8516d41936501839055800b10eca5d304',
 'lib/eventEmitter2.js':'f1c14613aa90c10def4ca7238329270871997eb26f919f7074dc25533e3e75dd',
};
const native={arm64:['e6457d66f45af3facd02920a5b212164e80fe0bb758afe6e6eab1eceeba3fc9a','21c589109bca43e287df884f3c34ab888033a83927ea7d273949ac5030583f26'],x64:['edab585d5c5c7bf35143a7a53b7d72652e90723b5f9635dfd55b2333f7069198','46a4455777c6122d7e71cd706ea4b37b19bedd297684be8b6dabb833ff2a3965']};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receiptName='YNX-SIGNED-DISTRIBUTION.json';
export function reviewedPtyFiles(){
 if(process.platform!=='darwin'||!native[process.arch])throw Error('Reviewed macOS PTY platform required.');
 return Object.entries({...common,[`prebuilds/darwin-${process.arch}/pty.node`]:native[process.arch][0],[`prebuilds/darwin-${process.arch}/spawn-helper`]:native[process.arch][1]}).map(([path,sourceSha256])=>({path,sourceSha256,kind:path.startsWith('prebuilds/')?'macho':'source'}));
}
async function regular(root,path){
 const file=join(root,path),stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||await realpath(file)!==file)throw Error('Regular canonical PTY closure required.');
 return readFile(file);
}
async function rootFor(resources){
 if(resolve(resources)!==resources||await realpath(resources)!==resources)throw Error('Canonical packaged resources required.');
 const root=join(resources,'code/apps/developer/node_modules/node-pty');
 if(await realpath(root)!==root)throw Error('PTY package location changed.');
 for(const name of ['build/Release','build/Debug']){try{await lstat(join(root,name));}catch(error){if(error.code==='ENOENT')continue;throw error;}throw Error('Unreviewed PTY native override.');}
 return root;
}
function adhoc(path){
 execFileSync('/usr/bin/codesign',['--verify','--strict',path],{stdio:'pipe'});
 const {stderr,status}=execFileSyncDisplay(path);
 if(status!==0||!stderr.includes('Signature=adhoc')||!stderr.includes('TeamIdentifier=not set'))throw Error('PTY native image is not the package ad-hoc signing class.');
}
function execFileSyncDisplay(path){return spawnSync('/usr/bin/codesign',['-dv','--verbose=4',path],{encoding:'utf8'});}
async function controlledSignedDigest(entry){
 const original=await regular(join(developer,'node_modules/node-pty'),entry.path);
 if(sha(original)!==entry.sourceSha256)throw Error('Reviewed original PTY native source changed before sealing.');
 const temporary=await mkdtemp('/private/tmp/ynx-pty-signing-reference-');
 try{
  const stat=await lstat(temporary);
  if(stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700||stat.isSymbolicLink()||await realpath(temporary)!==temporary)throw Error('Unsafe native signing reference directory.');
  const name=entry.path.split('/').at(-1),reference=join(temporary,name);
  await writeFile(reference,original,{flag:'wx',mode:entry.bundledMode});
  await chmod(reference,entry.bundledMode);
  execFileSync('/usr/bin/codesign',['--force','--sign','-',reference],{stdio:'pipe'});
  adhoc(reference);
  return sha(await regular(temporary,name));
 }finally{await rm(temporary,{recursive:true});}
}
export async function preparePtyDistribution(resources){
 const root=await rootFor(resources),files=[];
 try{await lstat(join(root,receiptName));throw Error('EEXIST: refusing existing PTY distribution.');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const entry of reviewedPtyFiles()){
  if(sha(await regular(join(developer,'node_modules/node-pty'),entry.path))!==entry.sourceSha256||sha(await regular(root,entry.path))!==entry.sourceSha256)throw Error('Reviewed original PTY closure changed.');
  const sourceMode=(await lstat(join(developer,'node_modules/node-pty',entry.path))).mode&0o777;
  const bundledMode=(await lstat(join(root,entry.path))).mode&0o777;
  if(sourceMode!==0o644||bundledMode!==sourceMode)throw Error('Reviewed original PTY file mode changed.');
  files.push({...entry,bundledSha256:entry.sourceSha256,sourceMode,bundledMode});
 }
 // The retained prebuild omitted its executable mode. Apply only the reviewed
 // package output permission, never run upstream installation scripts.
 await chmod(join(root,`prebuilds/darwin-${process.arch}/spawn-helper`),0o755);
 files.at(-1).bundledMode=0o755;
 await writeFile(join(root,receiptName),JSON.stringify({schemaVersion:1,name:'node-pty',version:'1.1.0',platform:`darwin-${process.arch}`,signingClass:'adhoc-no-team-id',files},null,2)+'\n',{flag:'wx',mode:0o600});
}
async function record(resources){
 const root=await rootFor(resources),bytes=await regular(root,receiptName),ledger=JSON.parse(bytes),expected=reviewedPtyFiles();
 if(ledger.schemaVersion!==1||ledger.name!=='node-pty'||ledger.version!=='1.1.0'||ledger.platform!==`darwin-${process.arch}`||ledger.signingClass!=='adhoc-no-team-id'||!Array.isArray(ledger.files)||ledger.files.length!==expected.length)throw Error('Invalid PTY distribution identity.');
 for(const [index,entry] of ledger.files.entries())if(['path','sourceSha256','kind'].some(key=>entry[key]!==expected[index][key])||!/^[a-f0-9]{64}$/.test(entry.bundledSha256)||entry.sourceMode!==0o644||entry.bundledMode!==(entry.path.endsWith('/spawn-helper')?0o755:0o644))throw Error('Invalid PTY distribution entry.');
 return {root,bytes,ledger};
}
export async function sealPtyDistribution(resources){
 const {root,ledger}=await record(resources);
 for(const entry of ledger.files){
  const digest=sha(await regular(root,entry.path));
  if(((await lstat(join(root,entry.path))).mode&0o777)!==entry.bundledMode)throw Error('PTY output file mode changed.');
  if(entry.kind==='source'&&digest!==entry.sourceSha256)throw Error('Signing changed PTY source bytes.');
  if(entry.kind==='macho'){
   adhoc(join(root,entry.path));
   if(digest!==await controlledSignedDigest(entry))throw Error('Signed PTY native payload differs from the reviewed original signing transformation.');
  }
  entry.bundledSha256=digest;
 }
 const bytes=JSON.stringify(ledger,null,2)+'\n';await writeFile(join(root,receiptName),bytes);
 const path=join(resources,'build-provenance.json'),provenance=JSON.parse(await readFile(path));
 provenance.debugPtyDistribution={path:'Contents/Resources/code/apps/developer/node_modules/node-pty/'+receiptName,sha256:sha(Buffer.from(bytes))};
 await writeFile(path,JSON.stringify(provenance,null,2)+'\n');
}
export async function verifyPtyDistribution(resources){
 const {root,bytes,ledger}=await record(resources),provenance=JSON.parse(await regular(resources,'build-provenance.json'));
 if(provenance.debugPtyDistribution?.path!=='Contents/Resources/code/apps/developer/node_modules/node-pty/'+receiptName||provenance.debugPtyDistribution.sha256!==sha(bytes))throw Error('PTY provenance differs.');
 for(const entry of ledger.files){if(sha(await regular(root,entry.path))!==entry.bundledSha256||(entry.kind==='source'&&entry.bundledSha256!==entry.sourceSha256))throw Error('Final signed PTY bytes differ.');if(((await lstat(join(root,entry.path))).mode&0o777)!==entry.bundledMode)throw Error('PTY output file mode changed.');if(entry.kind==='macho')adhoc(join(root,entry.path));}
 if(((await lstat(join(root,`prebuilds/darwin-${process.arch}/spawn-helper`))).mode&0o777)!==0o755)throw Error('Packaged PTY spawn helper mode differs.');
 return ledger;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,resources]=process.argv.slice(2);if(mode==='prepare')await preparePtyDistribution(resources);else if(mode==='seal')await sealPtyDistribution(resources);else if(mode==='verify'){await verifyPtyDistribution(resources);console.log('Final signed debug PTY closure and provenance match.');}else throw Error('Expected prepare/seal/verify Resources.');
}
