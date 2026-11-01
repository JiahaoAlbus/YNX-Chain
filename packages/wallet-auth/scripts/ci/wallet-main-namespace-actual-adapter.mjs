// Dedicated new adapter controls only; normal relative supplier closure.
import fs from'node:fs';import path from'node:path';import os from'node:os';import crypto from'node:crypto';import{fileURLToPath,pathToFileURL}from'node:url';import{spawnSync}from'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2]?path.resolve(process.argv[2]):fs.mkdtempSync(path.join(os.tmpdir(),'wallet-native-adapter-ci-'));fs.mkdirSync(out,{recursive:true});const stage=path.join(out,'stage');fs.mkdirSync(stage,{recursive:true});
const steps=[],pin=p=>{const b=fs.readFileSync(p);return{bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}};
function run(name,command,args){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});fs.writeFileSync(path.join(out,name+'.log'),(r.stdout??'')+(r.stderr??''));steps.push({name,command,args,status:r.status,signal:r.signal,error:r.error?.code});if(r.error||r.status!==0)throw Error('WALLET_MAIN_CONTROL_FAILED:'+name);}
let failure=null;const inputs=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/wallet-main-namespace-native-inputs.json'))).files;
function check(){for(const row of inputs){const observed=pin(path.join(root,row.path));if(observed.bytes!==row.bytes||observed.sha256!==row.sha256)throw Error('WALLET_MAIN_NATIVE_CONTROL_INPUT_CHANGED:'+row.path);}}
try{
 check();run('new-js10',process.execPath,['--test','test/wallet-main-namespace-actual-adapter.test.mjs']);
 run('types',process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--target','es2022','--module','nodenext','--moduleResolution','nodenext','test/wallet-main-namespace-bootstrap.types.mts']);
 if(!['darwin','linux'].includes(process.platform))throw Error('WALLET_MAIN_NATIVE_CONTROL_PLATFORM_UNSUPPORTED');
 const candidates=[path.resolve(path.dirname(process.execPath),'../include/node'),path.join(os.homedir(),'Library/Caches/node-gyp',process.versions.node,'include/node'),'/usr/include/node','/usr/local/include/node'];
 const headers=candidates.find(p=>fs.existsSync(path.join(p,'node_api.h')));if(!headers)throw Error('WALLET_MAIN_NATIVE_CONTROL_NODE_HEADERS_NOT_SUPPLIED');
 for(const n of ['original-wallet-main-namespace-bootstrap.js','original-wallet-main-namespace-node-loader-private.js'])fs.copyFileSync(path.join(root,'src',n),path.join(stage,n));
 fs.writeFileSync(path.join(stage,'package.json'),'{"type":"module"}\n');
 fs.writeFileSync(path.join(stage,'control.mjs'),'export let resolve;export const wait=new Promise(r=>resolve=r);\n');
 fs.writeFileSync(path.join(stage,'main.mjs'),"import{wait}from'./control.mjs';await wait;"+['captureOriginalWalletPayContextForNative','isOriginalWalletPayContextForNative','associateOriginalWalletPayNativeRetirement','copyOriginalWalletPayNativeDeadline'].map(n=>'export function '+n+'(){}').join('\n'));
 fs.writeFileSync(path.join(stage,'original-auth-identity-fixed-native-image.js'),"// PUBLIC test image only.\nimport{createRequire}from'node:module';export const native=createRequire(import.meta.url)('./namespace.node');export function loadOriginalAuthIdentityNativeImage(){return native;}\n");
 fs.writeFileSync(path.join(stage,'original-auth-runtime-image-source-v1.js'),"// PUBLIC admission interface only, no Root row.\nexport const events=[];export const owner={retire(){events.push('image.retire')},async join(){events.push('image.join')},async close(){events.push('image.close')}};export function acquireOriginalAuthRuntimeImageAdmissionV1(){return Promise.resolve({owner,error:null})}export function assertOriginalAuthRuntimeImagePreLoadCurrentV1(){}\n");
 const helper=path.join(stage,'original-wallet-main-namespace-node-loader-private.js'),hp=pin(helper);
 const args=['-std=c++17','-Wall','-Wextra','-Werror','-shared','-pthread',...(process.platform==='darwin'?['-undefined','dynamic_lookup']:['-fPIC']),'-I',headers,'-I',path.join(root,'native'),'-DYNX_PUBLIC_NAMESPACE_CONTROL=1','-DYNX_PUBLIC_MAIN_URI='+JSON.stringify(pathToFileURL(path.join(stage,'main.mjs')).href),'-DYNX_PUBLIC_LOADER_URI='+JSON.stringify(pathToFileURL(helper).href),'-DYNX_PUBLIC_LOADER_SHA='+JSON.stringify(hp.sha256),'-DYNX_PUBLIC_LOADER_BYTES='+hp.bytes,'native/pay_native_namespace_bootstrap.cpp','native/original-wallet-main-namespace-private.cpp','test/fixtures/wallet-main-namespace-public-code-root.fixture.cpp','-o',path.join(stage,'namespace.node')];
 run('new-native-3tu',process.platform==='darwin'?'clang++':'c++',args);
 for(const mode of ['accepted','pending','partial'])run('new-native-'+mode,process.execPath,['test/wallet-main-namespace-real-native.control.mjs',stage,mode]);
 check();
}catch(cause){failure=String(cause);}
const result={steps,failure,passed:failure===null,platform:process.platform,node:process.versions.node,inputs,producer:pin(path.join(root,'src/original-wallet-main-namespace-node-loader-private.js')),RootAdmission:false,SourceAdmission:false,NativeAdmission:false,normalWholeNative:false,actualMainAdmitted:false,installed:false};fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(out);if(failure)process.exitCode=1;
