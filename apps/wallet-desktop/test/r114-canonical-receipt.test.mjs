import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyCanonicalNativeReceipt,PINNED_NODE_HEADER_PINS} from '../scripts/canonical-package.mjs';
const base=['apps/wallet-desktop/native/original-auth-identity-node.mm',...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm'].map(n=>'packages/wallet-auth/native/'+n)];
const transport=['apps/wallet-desktop/native/original-ide-wallet-identity-source-owner.inc.mm',...['original-ide-wallet-identity-source.h','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.h','original-ide-wallet-peer-launch.mm'].map(n=>'packages/wallet-auth/native/'+n)];
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(selected,universal=false){
 const inputs=[...base,...selected],sourceRoot='/PUBLIC/source',headerRoot='/PUBLIC/headers',bytes=Buffer.from('PUBLIC fixture module, never loaded or compiled'),data=new Map(inputs.map(n=>[n,Buffer.from('// PUBLIC '+n)]));
 const sourceRel=[...base,...(selected.length?transport.filter(p=>p.endsWith('.mm')&&!p.endsWith('.inc.mm')):[])],output={relative:'apps/wallet-desktop/native/original-auth-identity.node',bytes:bytes.length,sha256:hash(bytes)},architectures=universal?['arm64','x86_64']:['arm64'];
 const commands=architectures.map(arch=>({tool:'/usr/bin/clang++',argv:['-std=c++17','-fobjc-arc','-dynamiclib','-undefined','dynamic_lookup','-DNAPI_VERSION=8','-DNODE_GYP_MODULE_NAME=original_auth_identity','-mmacosx-version-min=13.0','-I'+headerRoot,'-I'+path.join(sourceRoot,'packages/wallet-auth/native'),'-framework','Foundation','-framework','Security',...(selected.length?['-framework','AppKit']:[]),'-lbsm','-arch',arch,...sourceRel.map(n=>path.join(sourceRoot,n)),'-o',path.join(sourceRoot,output.relative)+(universal?'.'+(arch==='x86_64'?'x64':arch):'')]}));
 if(universal){const out=path.join(sourceRoot,output.relative);commands.push({tool:'/usr/bin/lipo',argv:['-create',out+'.arm64',out+'.x64','-output',out]})}
 const receipt={schemaVersion:1,kind:'YNX_WALLET_ORIGINAL_NATIVE_BUILD',napiVersion:8,headerVersion:'22.13.1',minimumSystemVersion:'13.0',readbackOnly:true,commandsKind:'normal-build-plan',appSigned:false,nativeQualified:false,registrationAccepted:false,relativeBases:{inputFiles:'repository-root',output:'repository-root',headers:'pinned-header-root'},sourceRoot,headerRoot,inputFiles:inputs.map(relative=>({relative,bytes:data.get(relative).length,sha256:hash(data.get(relative))})),headers:PINNED_NODE_HEADER_PINS,architectures,commands,output};
 return{receipt,run:()=>verifyCanonicalNativeReceipt(receipt,bytes,inputs,n=>data.get(n))};
}
test('R114 complete five-input selection accepts exact eight TUs plus AppKit on both architectures',()=>{
 for(const universal of [false,true])assert.equal(fixture(transport,universal).run().pinsVerified,true);
});
test('historical complete six-TU receipt is retained without AppKit',()=>{assert.equal(fixture([]).run().pinsVerified,true)});
test('every partial R114 selection is rejected rather than falling back to historical six TUs',()=>{
 for(const missing of transport)assert.throws(()=>fixture(transport.filter(p=>p!==missing)).run(),/receipt or input pins differ/);
});
test('R114 missing, extra or reordered TU/framework operands are refused',()=>{
 for(const mode of ['missingTU','extraTU','missingAppKit','extraFramework','reorderedTU']){
  const f=fixture(transport),args=f.receipt.commands[0].argv,tu=args.findIndex(s=>s.endsWith('/original-ide-wallet-peer-launch.mm'));
  if(mode==='missingTU')args.splice(tu,1);
  if(mode==='extraTU')args.splice(tu,0,args[tu]);
  if(mode==='missingAppKit')args.splice(args.indexOf('AppKit')-1,2);
  if(mode==='extraFramework')args.splice(args.indexOf('-lbsm'),0,'-framework','AppKit');
  if(mode==='reorderedTU')[args[tu],args[tu-1]]=[args[tu-1],args[tu]];
  assert.throws(f.run,/receipt or input pins differ/,mode);
 }
});
