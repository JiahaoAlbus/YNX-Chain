import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// Compiler-plan PUBLIC filesystem controls, not a Native execution or release.
const tool=readFileSync(new URL('../scripts/build-original-http-v5-native.mjs',import.meta.url),'utf8');
const root='/PUBLIC/repo',wallet=root+'/apps/wallet-desktop/native',script=root+'/apps/wallet-desktop/scripts/build-original-http-v5-native.mjs';
function fixture({missing,alias,entry=true,argv=[],existing}={}){
 const output=wallet+'/original-auth-identity.node',source=wallet+'/original-auth-identity-node.mm',calls=[];
 const base={output,outputs:[output],sources:[source],minimumSystemVersion:'13.0',commands:[{tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-I/PUBLIC/headers','-arch','arm64','-framework','Foundation',source,'-o',output]}]};
 const ctx={path,fileURLToPath,process:{argv,platform:'darwin',stdout:{write(){}}},existsSync:f=>f===existing,
  lstatSync(f){if(f===missing)throw Object.assign(Error('PUBLIC_MISSING'),{code:'ENOENT'});return{isFile:()=>true,isSymbolicLink:()=>false};},realpathSync:f=>f===alias?f+'.alias':f,
  readFileSync:f=>Buffer.from(f===source&&entry?'#include "original-product-device-v5-source-stage.inc.mm"\nRegisterOriginalProductDeviceV5SourceStage(env,exports)':'PUBLIC fixed source'),
  originalAuthNativeBuildPlan:()=>structuredClone(base),assertHTTPV5CoreInputs:()=>({source:'PUBLIC-8d-component',inputs:[{path:'apps/wallet-desktop/native/device-v5-protocol/libynx_artifact_release.a'}]}),
  execFileSync(...a){calls.push(a);throw Error('PUBLIC_COMPILER_FORBIDDEN');},assertOriginalAuthOwnedSymbols(){throw Error('PUBLIC_NOT_EXECUTED');},assertHTTPV5CoreExports(){throw Error('PUBLIC_NOT_EXECUTED');}};
 const text=tool.replace(/^import .*;$/mg,'').replace(/^export /mg,'').replaceAll('import.meta.url',JSON.stringify('file://'+script));
 runInNewContext(text.replace('if(process.argv[1]','this.plan=originalAuthHTTPV5BuildPlan;\nif(process.argv[1]'),ctx);
 return{plan:ctx.plan,calls};
}
test('V5 successor preserves Swift custody and initial-account exports with one new Core archive',()=>{
 const p=fixture().plan('arm64','/PUBLIC/headers'),link=p.commands.at(-1);
 assert.equal(link.tool,'/usr/bin/xcrun');assert(link.argv.includes('swiftc'));assert(link.argv.includes('-DYNX_ACCOUNT_INITIAL_NATIVE_V1'));
 assert(link.argv.includes(wallet+'/pq-transaction/NativePQCustodyExports.swift'));
 assert.equal(link.argv.filter(s=>s.endsWith('.a')).join(),wallet+'/device-v5-protocol/libynx_artifact_release.a');
 assert.equal(new Set(p.sources).size,p.sources.length);assert.equal(new Set(p.intermediateOutputs).size,p.intermediateOutputs.length);
 for(const o of p.intermediateOutputs){assert.equal(link.argv.filter(a=>a===o).length,1);assert.equal(p.commands.slice(0,-1).filter(c=>c.argv.at(-1)===o).length,1);}
 const native=p.commands.find(c=>c.argv.includes(wallet+'/original-auth-identity-node.mm'));
 for(const flag of ['-DYNX_ORIGINAL_WALLET_NATIVE_PQ_CUSTODY=1','-DYNX_ORIGINAL_PRODUCT_DEVICE_V5_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_STAGE'])assert(native.argv.includes(flag));
 for(const key of ['SourceAdmission','RootAdmission','installed'])assert.equal(p[key],false);
});
test('V5 successor refuses a missing normal stage and a node entry that would silently omit its methods',()=>{
 assert.throws(()=>fixture({missing:wallet+'/original-product-device-v5-source-stage.inc.mm'}).plan('arm64','/PUBLIC/headers'),/PUBLIC_MISSING/);
 assert.throws(()=>fixture({entry:false}).plan('arm64','/PUBLIC/headers'),/NORMAL_NAPI_ENTRY_REQUIRED/);
 assert.throws(()=>fixture({alias:wallet+'/original-product-device-v5-factory.mm'}).plan('arm64','/PUBLIC/headers'),/REGULAR_SOURCE_REQUIRED/);
});
test('V5 role preserves old addon and object files before any compiler is selected',()=>{
 for(const existing of [wallet+'/original-auth-identity.node',wallet+'/original-auth-http-v5.arm64.0.o'])assert.throws(()=>fixture({existing,argv:['node',script,'arm64','/PUBLIC/headers']}),/OUTPUT_EXISTS/);
});
test('unsupported architectures and surplus CLI operands cannot fall back to an old build',()=>{
 for(const a of ['x64','universal','other'])assert.throws(()=>fixture().plan(a,'/PUBLIC/headers'),/BUILD_INPUT_INVALID/);
 assert.throws(()=>fixture({argv:['node',script,'arm64','/PUBLIC/headers','unexpected']}),/BUILD_INPUT_INVALID/);
});
