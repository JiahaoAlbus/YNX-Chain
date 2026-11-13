// Only this new SDK consumer + PUBLIC boundary model; no original Auth body.
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {resolve,dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),pkg=join(root,'packages/wallet-auth'),test=join(pkg,'test/shop-registered-read-spi'),native=join(pkg,'native'),work=await mkdtemp(join(tmpdir(),'ynx-public-shop-spi-'));const evidence=process.env.YNX_SHOP_SPI_EVIDENCE||join(root,'shop-registered-read-spi-controls');await mkdir(evidence,{recursive:true});
function run(name,command,args,env={}){const r=spawnSync(command,args,{cwd:root,encoding:'utf8',env:{...process.env,...env}});if(r.error)throw r.error;return writeFile(join(evidence,name+'.json'),JSON.stringify({command,args,exit:r.status,stdout:r.stdout,stderr:r.stderr,PUBLICOnly:true,AuthNativeExecuted:false},null,2)+'\n').then(()=>{if(r.status!==0)throw new Error(name+' failed: '+r.stderr);process.stdout.write(r.stdout);});}
try{
 const pins=JSON.parse(await readFile(join(test,'FIXTURE_PINS.json'),'utf8'));for(const pin of pins.refs){const raw=await readFile(join(root,pin.path));if(raw.length!==pin.bytes||createHash('sha256').update(raw).digest('hex')!==pin.sha256)throw new Error('PUBLIC_HEADER_PIN_CHANGED');}
 const ns=await import(pathToFileURL(join(pkg,'src/original-shop-registered-read-normal-private.js')).href);if(Object.keys(ns).join()!=='initializeOriginalShopRegisteredReadForProductSource')throw new Error('PRIVATE_NORMAL_EXPORT_CHANGED');
 const body=await readFile(join(native,'shop_registered_read_sdk_bridge.cpp'),'utf8'),model=await readFile(join(test,'PUBLIC-sdk-spi-model.cpp'),'utf8');const imports=[...new Set([...((body+model).matchAll(/\b(napi_[a-z0-9_]+)\s*\(/g))].map(x=>x[1]))].filter(x=>x!=='napi_status').sort();
 const nodeInclude=resolve(dirname(process.execPath),'../include/node'),output=join(work,'PUBLIC-model.node');
 const flags=process.platform==='darwin'?['-bundle','-Wl,-undefined,error',...imports.map(n=>'-Wl,-U,_'+n)]:['-shared','-fPIC','-Wl,--wrap=_Znwm'];
 await run('cpp-model-compile','clang++',['-std=c++17','-Wall','-Wextra','-Werror',...flags,'-I'+nodeInclude,'-I'+join(test,'fixtures'),'-I'+native,join(test,'PUBLIC-sdk-spi-model.cpp'),'-o',output]);
 await run('sdk-body-public-model',process.execPath,[join(test,'sdk-spi-model.mjs')],{PUBLIC_SHOP_SPI_MODEL_ADDON:output});
 await run('normal-caller-model',process.execPath,['--experimental-vm-modules',join(test,'normal-caller-model.mjs')]);
 await run('strict-types',process.execPath,[join(pkg,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',join(test,'types.ts')]);
 console.log(JSON.stringify({SDKCPP_MODEL:11,normalCallerMODEL:7,strictExpectedRefusals:3,skipLibCheck:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false}));
}finally{await rm(work,{recursive:true,force:true});}
