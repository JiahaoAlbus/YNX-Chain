import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,lstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const pkg=path.join(repo,'packages/wallet-auth');
const contract=JSON.parse(readFileSync(new URL('./sdk49-pair-daemon-source-contract.json',import.meta.url)));
assert.equal(contract.sourceFiles.length,16);
for(const row of contract.sourceFiles){
 const raw=readFileSync(path.join(repo,row.relative));
 assert.equal(raw.length,row.bytes,`Auth source size differs: ${row.relative}`);
 assert.equal(createHash('sha256').update(raw).digest('hex'),row.sha256,`Auth source differs: ${row.relative}`);
}
if(process.argv.includes('--source-check')){
 console.log(JSON.stringify({sourceFilesExact:16,NativeCompiled:false,HTTPExecuted:false}));
 process.exit(0);
}
const out=process.env.SDK49_PAIR_EVIDENCE ?? path.join(process.env.RUNNER_TEMP,'sdk49-pair-daemon-package');
mkdirSync(out,{recursive:true});
const work=mkdtempSync(path.join(out,'actual-'));
const results=[];
const pin=p=>{const b=readFileSync(p);return {path:p,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
function record(){writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({
  pass:results.length===3&&results.every(r=>r.actualExit===0),results,work,
  scope:'New standalone npm package layout plus original v2/non-v2 HTTP listeners and shutdown. Source remains default-off; no issuer20 or Native compilation/signing.',
  configuredSource:false,NativeAdmission:false,installed:false,deployed:false,
},null,2)+'\n');}
function run(name,tool,args,env={}){
 const r=spawnSync(tool,args,{cwd:repo,env:{...process.env,...env},timeout:90000,maxBuffer:8<<20});
 const stdout=path.join(work,name+'.stdout'),stderr=path.join(work,name+'.stderr');
 writeFileSync(stdout,r.stdout??'');writeFileSync(stderr,r.stderr??'');
 results.push({name,actualExit:r.status,signal:r.signal,stdout:pin(stdout),stderr:pin(stderr)});record();
 assert.equal(r.status,0,`${name} failed; exact stdout/stderr retained at ${work}`);return r.stdout.toString();
}
const packed=JSON.parse(run('npm-pack','npm',['pack',pkg,'--ignore-scripts','--json','--pack-destination',work]));
assert.equal(packed.length,1);
const names=new Set(packed[0].files.map(f=>f.path));
const added=[
 'native/original-source-root-contract-v2.mjs','native/original-source-root-consumer-v2.mjs',
 'native/original-source-root-dirfd-journal.h','native/original-source-root-dirfd-node.cpp',
 'src/original-source-root-ledger-v2.js','src/original-source-root-owner-v2.js','src/original-source-root-operator-v2.js',
 'src/product-pair-session-v4-schema.sql','src/product-pair-session-v4-store.js','src/product-pair-session-v4-issuer.js',
 'src/product-pair-session-v4-account-source.js','src/product-pair-session-v4-source.js','src/product-pair-session-v4-http.js',
 'src/product-pair-session-v4-daemon.js',
];
for(const name of added)assert(names.has(name),`Required production package member missing: ${name}`);
assert(![...names].some(n=>n.endsWith('.node')||n.endsWith('YNXIdentityReceiver')),'Test package must not smuggle an installed Native/helper image');
const unpack=path.join(work,'unpacked');mkdirSync(unpack);
run('tar-extract','tar',['-xzf',path.join(work,packed[0].filename),'-C',unpack]);
const stage=path.join(unpack,'package');
const newMembers=added.map(name=>{
 const target=path.join(stage,name);assert(lstatSync(target).isFile()&&!lstatSync(target).isSymbolicLink());
 assert.deepEqual(readFileSync(target),readFileSync(path.join(pkg,name)));return {relative:name,...pin(target)};
});
writeFileSync(path.join(work,'NEW_PRODUCTION_PACKAGE_MEMBERS.json'),JSON.stringify({npmMembers:packed[0].files.length,newMembers,archive:pin(path.join(work,packed[0].filename)),dependencies:'Existing exact installed package dependencies copied for isolated test resolution, no provider or Native image substitution'},null,2)+'\n');
// Dependencies are not part of the SDK archive. Keep the standalone SDK files
// physically separate so repository-only imports cannot conceal missing files.
cpSync(path.join(pkg,'node_modules'),path.join(stage,'node_modules'),{recursive:true});
const tmp=path.join(work,'tmp');mkdirSync(tmp,{mode:0o700});
run('actual-packed-v2-and-nonv2',process.execPath,[
 '--test','--test-name-pattern=^REAL (v2 Host|v3 gatewayd)',
 path.join(repo,'scripts/ci/sdk49-pair-daemon-controls.test.mjs'),
],{AUTH_PAIR_V4_STAGE:stage,AUTH_PAIR_V4_EVIDENCE:work,TMPDIR:tmp,TMP:tmp,TEMP:tmp});
record();console.log(JSON.stringify({out,work,results}));
