// Normal offline build tooling package verification. Never issues or approves a release.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {generateAuthRuntimeClosure} from '../../packages/wallet-auth/scripts/auth-runtime-closure.mjs';

if(process.argv.length!==2)throw Error('PAIR_PACKAGE_CHECK_ZERO_ARGUMENTS_REQUIRED');
const root=path.resolve(import.meta.dirname,'../..');
const pkg=path.join(root,'packages/wallet-auth');
const out=fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP??os.tmpdir()),'root-pair-current-package-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const pin=p=>{const b=fs.readFileSync(p);return {path:p,bytes:b.length,sha256:sha(b)};};
function run(command,args,cwd=pkg){
 const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:8<<20});
 if(r.error||r.status!==0)throw Error(JSON.stringify({command,args,status:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout,stderr:r.stderr}));
 return r.stdout;
}
const info=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',out]))[0];
const required=[
 'docs/original-device-v4-completion.md','native/original-pay-cloud-bill-source-contract.mjs',
 'src/social-local-signed-v2.js','scripts/commission-pair-current-sdk.mjs',
 'scripts/pair-service-commissioning/commission-sdk.mjs',
 'scripts/pair-service-commissioning/postprocess-reviewed-source.mjs',
 'scripts/pair-service-commissioning/emit-reviewed-source.mjs',
 'scripts/pair-service-commissioning/release-selected-inputs.mjs'
];
required.push('scripts/commission-pair-current-sdk.mjs','src/root-current-v3/root-read-current-owner-v3.mjs','src/root-current-v3/root-current-producer-v3.mjs');
const names=new Set(info.files.map(f=>f.path));
const baseline=JSON.parse(fs.readFileSync(new URL('./root-pair-package-baseline.json',import.meta.url)));
for(const n of baseline.members)if(!names.has(n))throw Error('PAIR_PREVIOUS_NORMAL_PACKAGE_MEMBER_LOST:'+n);
for(const n of required)if(!names.has(n))throw Error('PAIR_NORMAL_PACKAGE_REQUIRED:'+n);
run('tar',['-xzf',path.join(out,info.filename),'-C',out]);
const packed=path.join(out,'package');
const checked=[];
for(const f of info.files){
 if(f.path.startsWith('/')||f.path.split('/').includes('..'))throw Error('PAIR_PACKAGE_PATH');
 if(/(^|\/)test\//.test(f.path)&&/pair-service-commissioning/.test(f.path))throw Error('PAIR_PUBLIC_FIXTURE_PACKED');
 const a=fs.readFileSync(path.join(pkg,f.path)),b=fs.readFileSync(path.join(packed,f.path));
 if(!a.equals(b))throw Error('PAIR_PACKAGE_SOURCE_MISMATCH:'+f.path);
 if(/\.(?:m?js)$/.test(f.path)&&/scripts\/pair-service-commissioning\//.test(f.path)&&/(?:from\s*|import\s*\()['"]\/(?:Volumes|Users)\//.test(b.toString()))throw Error('PAIR_PACKAGE_ABSOLUTE_IMPORT:'+f.path);
 checked.push({path:f.path,bytes:b.length,sha256:sha(b)});
}
fs.mkdirSync(path.join(packed,'node_modules'),{recursive:true});
for(const n of ['@noble','@ynx','@ynx-chain'])fs.cpSync(path.join(pkg,'node_modules',n),path.join(packed,'node_modules',n),{recursive:true});
const packedManifest=JSON.parse(fs.readFileSync(path.join(packed,'package.json')));
for(const name of ['./pair-service-commissioning','./runtime-image-commissioning','./social-local-signed-data','./pay-native-cloud-bill-source-data'])if(!packedManifest.exports?.[name])throw Error('ROOT_PAIR_EXISTING_EXPORT_LOST:'+name);
const app316=fs.readFileSync(path.join(packed,'integration/WALLET_APP_RUNTIME_DEPENDENCIES_316.json'));if(app316.length!==52668||sha(app316)!=='c12d1ce9a0aa9f4423e5f3d789f529c826266423e6b9c9b65da02cca9dcf331f'||!fs.readFileSync(path.join(packed,'scripts/normal-runtime-materialization.mjs'),'utf8').includes(sha(app316)))throw Error('ROOT_PAIR_APP316_COMPILED_PIN_DIFFERS');
if(!packedManifest.dependencies?.typescript)throw Error('PAIR_NORMAL_TOOL_TYPESCRIPT_NOT_DECLARED_PRODUCTION_DEPENDENCY');
fs.cpSync(path.join(pkg,'node_modules/typescript'),path.join(packed,'node_modules/typescript'),{recursive:true});
const r=spawnSync(process.execPath,['scripts/commission-pair-current-sdk.mjs'],{cwd:packed,encoding:'utf8',timeout:30000});
if(r.error||r.status!==65||r.signal||r.stdout.trim()!==''||JSON.parse(r.stderr).code!=='PAIR_V4_SOURCE_NOT_CONFIGURED')throw Error(JSON.stringify({code:'PAIR_PACKED_NORMAL_REFUSAL',status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message}));
run(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';import * as c from '@ynx-chain/wallet-auth/pair-current-commissioning';assert.equal(typeof c.commissionStableReviewedPairCurrentSDK,'function');assert.throws(()=>c.commissionStableReviewedPairCurrentSDK(),{code:'PAIR_V4_SOURCE_NOT_CONFIGURED'});"],packed);
const browser=spawnSync(process.execPath,['--conditions=browser','--input-type=module','-e',"import '@ynx-chain/wallet-auth/pair-current-commissioning'"],{cwd:packed,encoding:'utf8',timeout:10000});
if(browser.status===0||!browser.stderr.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'))throw Error('PAIR_PACKAGE_BROWSER_NOT_REFUSED');
const cliGraph=generateAuthRuntimeClosure(packed,{entries:['native/original-auth-identity-source-verifier.mjs']});
for(const row of cliGraph.manifest.files){const p=pin(path.join(packed,row.path));if(p.bytes!==(row.bytes??row.size)||p.sha256!==row.sha256)throw Error('PAIR_PACKED_CLI_GRAPH_BYTES:'+row.path);}
fs.writeFileSync(path.join(out,'NORMAL_ORIGINAL_CLI_STATIC_CLOSURE.json'),JSON.stringify({method:'Actual unpacked normal package original CLI static graph; no protected CLI invocation',archiveSHA256:pin(path.join(out,info.filename)).sha256,graph:cliGraph,everyRowActualBytesMatched:true,CLIExecuted:false,RootAdmission:false,SourceAdmission:false},null,2)+'\n');
fs.writeFileSync(path.join(out,'MEMBERS.json'),JSON.stringify(checked,null,2)+'\n');
const result={archive:pin(path.join(out,info.filename)),members:checked.length,memberInventory:pin(path.join(out,'MEMBERS.json')),everyMemberActualSourceMatched:true,previousPackageMembersRetained:baseline.members.length,previousPackageBaseCommit:baseline.baseCommit,requiredMembers:required,normalPackedZeroArgumentExit:65,normalPackedCode:'PAIR_V4_SOURCE_NOT_CONFIGURED',normalNodeSubpath:true,browserRefused:true,normalCLIStaticClosure:pin(path.join(out,'NORMAL_ORIGINAL_CLI_STATIC_CLOSURE.json')),normalCLIStaticFiles:cliGraph.manifest.files.length,normalCLIStaticEdges:cliGraph.report.edges.length,RootAdmission:false,SourceAdmission:false,runtimeImageQualified:false,CLIPrivateExecution:false,installed:false,realLogin:false,realRestore:false,realRevoke:false};
fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');
if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,'ROOT_PAIR_PACKAGE_ARTIFACT_DIR='+out+'\n');
console.log(JSON.stringify(result));
