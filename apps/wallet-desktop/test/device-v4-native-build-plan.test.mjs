import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
// PUBLIC filesystem/hash boundaries test the actual recipe without compiling,
// acquiring Native, or claiming a real archive was verified by this fixture.
const raw=readFileSync(new URL('../scripts/build-original-auth-identity-native.mjs',import.meta.url),'utf8');
function fixture(options={}){
 const protocolRoot='/PUBLIC/protocol',wallet='/PUBLIC/repo/apps/wallet-desktop/native',seen=[],hashes=new Map();let exports;
 const source=raw.replace(/^import .*;$/mg,'').replace(/^export /mg,'').replaceAll('import.meta.url',JSON.stringify('file:///PUBLIC/repo/apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs'));
 const context={fileURLToPath,path,process:{argv:options.argv??[],platform:'darwin'},execFileSync(){throw Error('PUBLIC_NO_COMPILER');},existsSync:file=>file.endsWith('/node_api.h')||file===options.existingOutput,lstatSync(file){
  if(file===options.missing)throw Object.assign(Error('PUBLIC_MISSING'),{code:'ENOENT'});
  const directory=['/','/PUBLIC',protocolRoot].includes(file);return {isFile:()=>!directory,isDirectory:()=>directory,isSymbolicLink:()=>file===options.symlink};
 },readFileSync(file){
  seen.push(file);if(file.endsWith('/package.json'))return '{"build":{"mac":{"minimumSystemVersion":"13.0"}}}';
  const pin=context.exports?.ORIGINAL_DEVICE_V4_PROTOCOL_PINS.find(p=>file===protocolRoot+'/'+p.name||file===wallet+'/product_session_http.h'&&p.name==='product_session_http.h');
  if(pin){const bytes=Buffer.alloc(pin.bytes);hashes.set(bytes,file===options.corrupt?'0'.repeat(64):pin.sha256);return bytes;}
  return Buffer.from('PUBLIC source operand, not actual Native');
 },createHash(){let input;return {update(bytes){input=bytes;return this;},digest(){return hashes.get(input)??'PUBLIC_UNSELECTED';}}}};
 const expose='this.exports={originalAuthNativeBuildPlan,originalIDEHelperBuildPlan,originalAuthDeviceV4BuildPlan,assertOriginalAuthOwnedSymbols,ORIGINAL_DEVICE_V4_PROTOCOL_PINS};\n';
 runInNewContext(source.replace('if(process.argv[1]',expose+'if(process.argv[1]'),context);exports=context.exports;
 return {...exports,seen,protocolRoot,wallet};
}
test('device-v4 opt-in plans separate C11 E5 before same-addon link, exact official operands and both flags',()=>{
 const f=fixture(),base=f.originalAuthNativeBuildPlan('arm64','/PUBLIC/headers'),plan=f.originalAuthDeviceV4BuildPlan('arm64','/PUBLIC/headers',f.protocolRoot);
 assert.equal(base.sources.length,15);assert.equal(plan.sources.length,18);assert.equal(plan.commands.length,2);
 const [e5,link]=plan.commands;assert.equal(e5.tool,'/usr/bin/clang');assert(e5.argv.includes('-std=c11'));assert(!e5.argv.includes('-fobjc-arc'));
 for(const flag of ['-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_SOURCE_STAGE','-DYNX_ORIGINAL_PRODUCT_DEVICE_V4_HTTP_PRODUCER_STAGE','-lresolv'])assert(link.argv.includes(flag));
 assert.equal(link.argv.filter(p=>p.endsWith('.a')).join(),f.protocolRoot+'/libynx_artifact_release.a');assert(link.argv.includes(e5.argv.at(-1)));
 assert.equal(link.argv.filter(p=>p.endsWith('/original-product-device-v4-factory.mm')).length,1);assert.equal(link.argv.filter(p=>p.endsWith('/original-product-device-v4-slot.mm')).length,1);
 assert(!link.argv.some(p=>p.includes('PUBLIC_TEST')));assert.equal(plan.nativeAdmission,false);assert.equal(plan.sourceAdmission,false);
 assert.equal(plan.protocolInputs.length,3);assert.equal(plan.deviceV4Inputs.length,14);assert.equal(plan.intermediateOutputs[0],e5.argv.at(-1));
});
test('default addon15 and helper11 stay without device flags, E5 or external protocol library',()=>{
 const f=fixture();for(const p of [f.originalAuthNativeBuildPlan('arm64','/PUBLIC/headers'),f.originalIDEHelperBuildPlan('arm64')]){
  assert.equal(p.sources.length,p.output.endsWith('.node')?15:11);
  assert(!p.commands.some(c=>c.argv.some(a=>/DEVICE_V4|product-device-v4|\.a$/.test(a))));
 }
});
test('opt-in refuses unsupported architectures and non-normalized protocol roots before input access',()=>{
 for(const arch of ['x64','universal','arm64-other']){const f=fixture();assert.throws(()=>f.originalAuthDeviceV4BuildPlan(arch,'/PUBLIC/headers',f.protocolRoot),/ARCHITECTURE_NOT_SUPPLIED/);assert.equal(f.seen.length,0);}
 for(const root of ['relative','/PUBLIC/../protocol',null])assert.throws(()=>fixture().originalAuthDeviceV4BuildPlan('arm64','/PUBLIC/headers',root),/PROTOCOL_ROOT_INVALID/);
});
test('wrong archive, manifest or header and symlink ancestry refuse planning',()=>{
 for(const name of ['libynx_artifact_release.a','SOURCE.json','product_session_http.h']){
  const f=fixture({corrupt:'/PUBLIC/protocol/'+name});assert.throws(()=>f.originalAuthDeviceV4BuildPlan('arm64','/PUBLIC/headers',f.protocolRoot),/PROTOCOL_PIN_DIFFERS/);
 }
 const f=fixture({corrupt:'/PUBLIC/repo/apps/wallet-desktop/native/product_session_http.h'});assert.throws(()=>f.originalAuthDeviceV4BuildPlan('arm64','/PUBLIC/headers',f.protocolRoot),/CALLER_HEADER_DIFFERS/);
 for(const symlink of ['/PUBLIC','/PUBLIC/protocol','/PUBLIC/protocol/SOURCE.json']){const f=fixture({symlink});assert.throws(()=>f.originalAuthDeviceV4BuildPlan('arm64','/PUBLIC/headers',f.protocolRoot),/PROTOCOL_ROOT_INVALID|SOURCE_NOT_REGULAR/);}
});
test('missing actual producer closure and unresolved owned symbols refuse, never use a test producer',()=>{
 const missing='/PUBLIC/repo/apps/wallet-desktop/native/original-product-device-v4-slot.mm',f=fixture({missing});assert.throws(()=>f.originalAuthDeviceV4BuildPlan('arm64','/PUBLIC/headers',f.protocolRoot),/PUBLIC_MISSING/);
 for(const symbol of ['_YNXProductSessionHTTPProofSignV4','_ynx_auth_device_http_v4_e5_data','__ZN16ynx_auth_privateFactory'])assert.throws(()=>f.assertOriginalAuthOwnedSymbols(' U '+symbol),/OWNED_SYMBOL_UNRESOLVED/);
 f.assertOriginalAuthOwnedSymbols('                 U _napi_create_object\n/PUBLIC/YNX/module.node (architecture arm64):');
});
test('explicit CLI refuses existing addon or E5 object before any compiler, and rejects surplus inputs',()=>{
 const argv=['node','/PUBLIC/repo/apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs','device-v4','arm64','/PUBLIC/headers','/PUBLIC/protocol'];
 for(const name of ['original-auth-identity.node','original-product-device-v4-e5.arm64.o'])assert.throws(()=>fixture({argv,existingOutput:'/PUBLIC/repo/apps/wallet-desktop/native/'+name}),/OUTPUT_EXISTS/);
 assert.throws(()=>fixture({argv:[...argv,'extra']}),/BUILD_INPUT_INVALID/);
});
