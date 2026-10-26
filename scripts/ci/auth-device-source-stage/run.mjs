import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),here=import.meta.dirname,out=process.env.AUTH_SOURCE4_EVIDENCE??path.join(process.env.RUNNER_TEMP,'auth49-source4-stage');mkdirSync(out,{recursive:true});
const results=[];
function run(name,tool,args,extra={}){const r=spawnSync(tool,args,{cwd:root,timeout:120000,maxBuffer:8<<20,env:{...process.env,...extra}});for(const k of ['stdout','stderr'])writeFileSync(path.join(out,name+'.'+k),r[k]??'');results.push({name,status:r.status,signal:r.signal});writeFileSync(path.join(out,'RESULT.json'),JSON.stringify({results,pass:results.every(x=>x.status===0),scope:'Actual Native Source4/SDK consumer. Lower Cocoa Source and verified scope explicitly PUBLIC mock; no profile, slot, key, HTTP issuer, Source/Native admission, App installation or real login/recovery/revocation.'},null,2)+'\n');if(r.status!==0)throw Error(name+' failed: '+r.stderr);}
if(process.platform!=='darwin')throw Error('ACTUAL_FOUNDATION_REQUIRED');
const version=process.versions.node,tarName=`node-v${version}-headers.tar.gz`,base=`https://nodejs.org/dist/v${version}/`;
let include=process.env.AUTH_SOURCE4_NODE_INCLUDE;
if(!include){
 const sums=await(await fetch(base+'SHASUMS256.txt')).text(),body=Buffer.from(await(await fetch(base+tarName)).arrayBuffer()),row=sums.split('\n').find(x=>x.endsWith('  '+tarName));
 if(!row||createHash('sha256').update(body).digest('hex')!==row.split(/\s+/)[0])throw Error('EXACT_NODE_HEADERS_SHA_MISMATCH');
 const tgz=path.join(out,tarName);writeFileSync(tgz,body);run('headers-extract','/usr/bin/tar',['-xzf',tgz,'-C',out]);include=path.join(out,`node-v${version}/include/node`);
}
if(!existsSync(path.join(include,'node_api.h')))throw Error('LOCAL_NODE_API_HEADERS_REQUIRED');
const actual=path.join(root,'apps/wallet-desktop/native/original-product-device-v4-source.inc.mm');
const fixture=path.join(out,'source4.mm'),addon=path.join(out,'source4.node');writeFileSync(fixture,readFileSync(path.join(here,'controls/device-v4-source-napi-fixture.mm.in'),'utf8').replace('@@ACTUAL_SOURCE_NAPI@@',actual));
run('actual-napi-compile','/usr/bin/clang++',['-std=c++17','-fobjc-arc','-DNAPI_VERSION=8','-bundle','-undefined','dynamic_lookup','-I'+include,'-framework','Foundation',fixture,'-o',addon]);
run('actual-sdk-node-source4-syntax','/usr/bin/clang++',['-std=c++17','-fobjc-arc','-x','objective-c++','-fsyntax-only','-DNAPI_VERSION=8','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-I'+include,'-I'+path.join(root,'packages/wallet-auth/native'),path.join(root,'apps/wallet-desktop/native/original-auth-identity-node.mm')]);
run('actual-napi-source4',process.execPath,['--test',path.join(here,'controls/device-v4-source-napi.test.mjs')],{AUTH_DEVICE_V4_TEST_ADDON:addon});
run('sdk-async-consumer',process.execPath,['--experimental-test-module-mocks','--test',path.join(here,'source4-consumer.test.mjs')],{AUTH_DEVICE_V4_TEST_ADDON:addon});
// Isolated dev compiler only. No runtime dependency, production install or ambient types.
run('type-tool-install','npm',['install','--prefix',path.join(out,'types'),'--ignore-scripts','--no-audit','--no-fund','--package-lock=false','typescript@5.9.3']);
const typeFile=path.join(out,'source4-types.mts');writeFileSync(typeFile,`import {acquireOriginalProductSessionDeviceV4SourceStage as acquire,type OriginalProductSessionDeviceSourceStageV4} from ${JSON.stringify(path.join(root,'packages/wallet-auth/src/original-product-device-v4-source-stage.js'))};\nimport type {OriginalProductSessionDeviceCurrentSourceV4,ProductSessionDevicePortsV4} from ${JSON.stringify(path.join(root,'packages/wallet-auth/src/product-session-device-v4.js'))};\nconst stage=acquire();const source:OriginalProductSessionDeviceCurrentSourceV4=stage;\n// @ts-expect-error no public brand construction\nconst fake:OriginalProductSessionDeviceSourceStageV4={};\n// @ts-expect-error Source is not private HTTP producer\nconst device:ProductSessionDevicePortsV4=stage;\n// @ts-expect-error zero caller inputs\nacquire({});\n// @ts-expect-error no admission\nconst admitted:true=stage.status().nativeAdmission;\nvoid source;void fake;void device;void admitted;\n`);
run('source4-types',process.execPath,[path.join(out,'types/node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','es2022','--module','nodenext','--moduleResolution','nodenext',typeFile]);
console.log(JSON.stringify({out,results}));
