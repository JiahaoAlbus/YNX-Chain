// Build the existing app graph with the exact supplier's public RN SDK export.
// This is a candidate compatibility check, not installation or Native authority.
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const {values}=parseArgs({options:{'sdk-tgz':{type:'string'},'output-dir':{type:'string'}}});
if(!values['sdk-tgz']||!values['output-dir'])throw Error('Provide --sdk-tgz and --output-dir');
const expected='666f4b685109cf7d7c08f8a60fe82a1341dd44fc50dc7020e29a80bb82c58e46';
const digest=b=>createHash('sha256').update(b).digest('hex');
const tgz=resolve(values['sdk-tgz']),bytes=readFileSync(tgz);
if(bytes.length!==9361685||digest(bytes)!==expected)throw Error('SDK_CANDIDATE_PIN_MISMATCH');
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(values['output-dir']);if(existsSync(out))throw Error('FRESH_OUTPUT_DIRECTORY_REQUIRED');
mkdirSync(out,{recursive:true});
const run=(exe,args,opts={})=>{const {logPath,...spawnOpts}=opts;const r=spawnSync(exe,args,{cwd:out,encoding:'utf8',...spawnOpts});if(logPath)writeFileSync(logPath,(r.stdout||'')+(r.stderr||''));if(r.error)throw r.error;if(r.status!==0)throw Error(`${exe} exit ${r.status}: ${(r.stderr||r.stdout||'').slice(-3000)}`);return r;};
const listing=run('tar',['-tzf',tgz]).stdout.trim().split('\n');
if(listing.some(p=>!p.startsWith('package/')||p.split('/').includes('..')))throw Error('SDK_ARCHIVE_PATH_INVALID');
const modules=join(out,'node_modules'),sdk=join(modules,'@ynx-chain','wallet-auth');mkdirSync(sdk,{recursive:true});
// A separate Metro project borrows existing app dependencies read-only. The
// exact SDK archive stays a physical package so its real exports are resolved.
for(const name of readdirSync(join(app,'node_modules'))){
 if(name==='@ynx-chain'){
  for(const child of readdirSync(join(app,'node_modules',name)))if(child!=='wallet-auth')symlinkSync(join(app,'node_modules',name,child),join(modules,name,child),'dir');
 }else symlinkSync(join(app,'node_modules',name),join(modules,name),'dir');
}
writeFileSync(join(out,'package.json'),readFileSync(join(app,'package.json')));
for(const name of ['app.json','babel.config.js','babel.config.cjs'])if(existsSync(join(app,name)))writeFileSync(join(out,name),readFileSync(join(app,name)));
run('tar',['-xzf',tgz,'--strip-components=1','-C',sdk]);
const metadata=JSON.parse(readFileSync(join(sdk,'package.json'),'utf8'));
const entry=metadata.exports['./original-ai-task-action-v6-client'];
if(entry['react-native']!=='./src/original-ai-task-action-v6-mobile.mjs'||entry.browser!==null||entry.default!==null)throw Error('SDK_FINITE_EXPORT_CHANGED');
const leaf=readFileSync(join(sdk,entry['react-native']));
if(digest(leaf)!=='36a45a24af7b4fff3e0cf77d6d1021829fc4846f86b37e3867812d74bfa3fd58')throw Error('SDK_MOBILE_LEAF_CHANGED');
const boundary=run(process.execPath,['--conditions=react-native','--input-type=module','-e',`
import assert from 'node:assert/strict';
import {openOriginalAITaskActionClientV6 as open} from '@ynx-chain/wallet-auth/original-ai-task-action-v6-client';
await assert.rejects(open(),e=>e.code==='AI_V6_MOBILE_NATIVE_GETTER_NOT_SUPPLIED');
await assert.rejects(open('not-an-authority'),e=>e.code==='AI_V6_ZERO_INPUT');
console.log('PUBLIC_RN_EXPORT_REACHED; ORIGINAL_NATIVE_GETTER_NOT_SUPPLIED');
`]);writeFileSync(join(out,'boundary.log'),boundary.stdout+boundary.stderr);
const require=createRequire(join(app,'package.json'));
const config=join(out,'metro.config.cjs');
writeFileSync(config,`const {getDefaultConfig}=require(${JSON.stringify(require.resolve('expo/metro-config'))});\nconst c=getDefaultConfig(${JSON.stringify(out)});\nc.watchFolders=[...(c.watchFolders||[]),${JSON.stringify(app)}];\nc.resolver.nodeModulesPaths=[${JSON.stringify(modules)},...(c.resolver.nodeModulesPaths||[])];\nmodule.exports=c;\n`);
const wrapper=join(out,'index.js');
writeFileSync(wrapper,`import ${JSON.stringify(join(app,'index.ts'))};\nexport {openOriginalAITaskActionClientV6} from '@ynx-chain/wallet-auth/original-ai-task-action-v6-client';\n`);
const result={sdk:{bytes:bytes.length,sha256:expected,version:metadata.version},sourceCommit:run('git',['-C',app,'rev-parse','HEAD']).stdout.trim(),normalEntry:join(app,'index.ts'),publicEntry:'@ynx-chain/wallet-auth/original-ai-task-action-v6-client',platforms:[],NativeGetterSupplied:false,clientOperational:false,HermesVMExecuted:false,installed:false,deployed:false};
for(const platform of ['android','ios']){
 const bundle=join(out,`${platform}.hbc`),map=join(out,`${platform}.map`);
 const r=run(process.execPath,[join(app,'node_modules','expo','bin','cli'),'export:embed','--entry-file',wrapper,'--platform',platform,'--dev','false','--bytecode','--max-workers','2','--config',config,'--bundle-output',bundle,'--sourcemap-output',map],{cwd:out,logPath:join(out,`${platform}.log`),env:{...process.env,CI:'1',EXPO_NO_TELEMETRY:'1'}});
 writeFileSync(join(out,`${platform}.log`),r.stdout+r.stderr);
 const graph=JSON.parse(readFileSync(map,'utf8'));const sdkSources=graph.sources.filter(p=>p.includes('wallet-auth/'));
 if(sdkSources.length!==1||!sdkSources[0].endsWith('/src/original-ai-task-action-v6-mobile.mjs'))throw Error('SDK_HERMES_GRAPH_NOT_FINITE');
 const body=readFileSync(bundle);if(body.subarray(0,8).toString('hex')!=='c61fbc03c103191f')throw Error('NOT_HERMES_BYTECODE');
 result.platforms.push({platform,bytes:body.length,sha256:digest(body),sources:graph.sources.length,sdkSources,buildExit:0});
 writeFileSync(join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify(result,null,2));
