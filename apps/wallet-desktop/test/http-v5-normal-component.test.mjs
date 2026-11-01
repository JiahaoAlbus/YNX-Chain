import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {HTTP_V5_NORMAL_ROLE,HTTP_V5_NORMAL_INPUT,HTTP_V5_NORMAL_INPUT_NAMES,verifyHTTPV5NormalComponent} from '../scripts/wallet-http-v5-native-component.mjs';
import {canonicalNativeInputSelection,PINNED_NODE_HEADER_PINS,verifyCanonicalNativeReceipt} from '../scripts/canonical-package.mjs';
import {verifySDK13NativeComponent} from '../scripts/sdk13-native-component.mjs';
// Actual frozen source bytes, PUBLIC output/receipt DATA. These tests do not
// create a Native image, perform Source admission, or attest compilation.
const root=fileURLToPath(new URL('../../..',import.meta.url)),read=n=>fs.readFileSync(path.join(root,n)),m=JSON.parse(read(HTTP_V5_NORMAL_INPUT.path)),hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const native=Buffer.from('PUBLIC addon DATA'),helper=Buffer.from('PUBLIC helper DATA'),sourceRoot='/PUBLIC/repo',headerRoot='/PUBLIC/headers',pin=(relative,b)=>({relative,bytes:b.length,sha256:hash(b)}),commands=rows=>rows.map(c=>({tool:c.tool,argv:c.argv.map(a=>a.replaceAll('${SOURCE_ROOT}',sourceRoot).replaceAll('${HEADER_ROOT}',headerRoot))})),inputs=[...m.files,HTTP_V5_NORMAL_INPUT].map(p=>({relative:p.path,bytes:p.bytes,sha256:p.sha256})).sort((a,b)=>a.relative.localeCompare(b.relative,'en')),scan=relative=>({tool:'/usr/bin/nm',argv:['-u',sourceRoot+'/'+relative],exit:0,stdoutSHA256:hash(Buffer.from('PUBLIC scan')),ownedUndefined:[]});
 const record={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:false,commandsKind:'executed-normal-build',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot,headerRoot,sourceInventory:{relative:m.sdkInventory.path,bytes:m.sdkInventory.bytes,sha256:m.sdkInventory.sha256},inputFiles:inputs,headers:PINNED_NODE_HEADER_PINS,architectures:['arm64'],httpV5NormalRole:HTTP_V5_NORMAL_ROLE,commands:commands(m.commands),exitCodes:m.commands.map(()=>0),output:pin('apps/wallet-desktop/native/original-auth-identity.node',native),ownedUndefinedScan:scan('apps/wallet-desktop/native/original-auth-identity.node')};
 record.helperBuild={kind:'YNX_WALLET_ORIGINAL_HELPER_BUILD/v1',sourceRoot,readbackOnly:false,commandsKind:'executed-normal-build',executed:true,serviceRegistered:false,installed:false,nativeQualified:false,appSigned:false,architectures:['arm64'],commands:commands(m.helperCommands),exitCodes:m.helperCommands.map(()=>0),inputFiles:inputs,output:pin('apps/developer/helper/YNXIdentityReceiver',helper),packagedOutput:pin('apps/wallet-desktop/native/YNXIdentityReceiver',helper),ownedUndefinedScan:scan('apps/developer/helper/YNXIdentityReceiver')};
 return{record,native,helper,check:r=>verifyHTTPV5NormalComponent({record:r,inventoryBytes:read(m.sdkInventory.path),moduleBytes:native,helperBytes:helper},read)};
}
test('normal canonical component selects the exact new recipe, full source pins and helper closure without old-role qualification',()=>{
 const f=fixture(),selection=canonicalNativeInputSelection(m.sdkVersion,HTTP_V5_NORMAL_INPUT_NAMES,read(m.sdkInventory.path),f.record.inputFiles);assert.equal(selection.inputs.length,HTTP_V5_NORMAL_INPUT_NAMES.length);
 const c=f.check(f.record);assert.equal(c.helper.translationUnits,13);assert.equal(c.SourceAdmission,false);assert.equal(c.RootAdmission,false);assert.equal(c.installed,false);
 assert.equal(verifyCanonicalNativeReceipt(f.record,f.native,selection.inputs,read).pinsVerified,true);
 assert.equal(verifySDK13NativeComponent({record:f.record,inventoryBytes:read(m.sdkInventory.path),moduleBytes:f.native,helperBytes:f.helper},read).sourceBytesVerified,true);
});
test('missing compile, a second Go archive, helper include omission and nonzero exit refuse',()=>{
 for(const mode of ['compile','archive','helper','exit']){const f=fixture(),r=structuredClone(f.record);if(mode==='compile')r.commands.splice(1,1);if(mode==='archive')r.commands.at(-1).argv.push('/PUBLIC/old.a');if(mode==='helper')r.helperBuild.commands[0].argv=r.helperBuild.commands[0].argv.filter(a=>a!=='-I/PUBLIC/repo/apps/wallet-desktop/native');if(mode==='exit')r.exitCodes[0]=1;assert.throws(()=>f.check(r),/MATCHED_NORMAL_COMPONENT_REQUIRED/);}
});
test('changed SDK inventory, source pin, Node header and fabricated authority cannot borrow this recipe',()=>{
 for(const mode of ['source','header','role']){const f=fixture(),r=structuredClone(f.record);if(mode==='source')r.inputFiles[0].sha256='0'.repeat(64);if(mode==='header')r.headers[0].sha256='0'.repeat(64);if(mode==='role')r.httpV5NormalRole.RootAdmission=true;assert.throws(()=>f.check(r),/MATCHED_NORMAL_COMPONENT_REQUIRED/);}
 const f=fixture();assert.throws(()=>canonicalNativeInputSelection(m.sdkVersion,HTTP_V5_NORMAL_INPUT_NAMES,Buffer.from('PUBLIC old inventory'),f.record.inputFiles),/MATCHED_NORMAL_COMPONENT_REQUIRED/);
});
