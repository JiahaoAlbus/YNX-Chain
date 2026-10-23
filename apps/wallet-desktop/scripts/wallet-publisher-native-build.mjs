import path from 'node:path';
export const WALLET_NATIVE_SOURCE_PROFILES=Object.freeze({
 '1.3.0-pq.3.32-auth.13':Object.freeze({version:'1.3.0-pq.3.32-auth.13',supplierNodeInputs:69,inventory:Object.freeze({bytes:30418,sha256:'3d256c3c4581748448026d53bfd8160be1e00b80733b3d4c03af5ad30fb68a3c'}),tool:Object.freeze({bytes:10764,sha256:'ae074c5d82d29c2b10a5ef0a55947ccc8a4a127745308a464c8c465035e0ee81'})}),
 '1.3.0-pq.3.32-auth.14':Object.freeze({version:'1.3.0-pq.3.32-auth.14',supplierNodeInputs:71,inventory:Object.freeze({bytes:34752,sha256:'feafd827a9d42cea65af17b94944e6c565b8ef4b1e6eb56c938709811cc1eadf'}),tool:Object.freeze({bytes:10932,sha256:'c532946f53a6314d9c0ecb2ffb3afd2044f9ffb1961afbfe0b8ec32444f71461'})}),
 '1.3.0-pq.3.32-auth.18':Object.freeze({version:'1.3.0-pq.3.32-auth.18',supplierNodeInputs:75,inventory:Object.freeze({bytes:45891,sha256:'de4028e5ef58287c954c31c46b4e944828ae3e42712892eda3be6d659c44fbad'}),tool:Object.freeze({bytes:11989,sha256:'218c73f9883ef9263181453a7e12049009ccc400ec313e85c29ece3848ebc4dc'})})
});
export function walletNativeSourceProfile(version){if(typeof version!=='string'||!Object.hasOwn(WALLET_NATIVE_SOURCE_PROFILES,version))throw Error('WALLET_NATIVE_MATCHED_SDK_REQUIRED');return WALLET_NATIVE_SOURCE_PROFILES[version];}
export const WALLET_PUBLISHER_NATIVE_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.h',bytes:2687,sha256:'aa8d0d2f95ff11741c6ce1ecf68a4e10d56aadef581af98fb826f4a037999752'},
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.mm',bytes:6408,sha256:'a8559c47c975b1ccbb0469f962e47d3afbaf8343b2a75f41498d8003890ddc6f'}
].map(Object.freeze));
export const SDK13_NODE_TRANSLATION_UNITS=Object.freeze([
 'apps/wallet-desktop/native/original-auth-identity-node.mm',
 ...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.mm','original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-ide-publication-artifact.mm','original-ide-contract-relay-owner.mm'].map(n=>'packages/wallet-auth/native/'+n)
]);
const fail=()=>{throw Error('WALLET_PUBLISHER_NATIVE_PLAN_MISMATCH');};
/** Build-only composition. Original supplier bytes and helper recipe remain
 * unchanged. This extra private IO class is NOT Source/approval qualification.
 */
export function composeWalletPublisherNativeBuildPlan(plan,repo,supplierNodeInputCount=69){
 if(typeof repo!=='string'||!path.isAbsolute(repo)||path.normalize(repo)!==repo)fail();
 if(![69,71,75].includes(supplierNodeInputCount))fail();
 const sources=SDK13_NODE_TRANSLATION_UNITS.map(n=>path.join(repo,n));
 if(plan.minimumSystemVersion!=='13.0'||JSON.stringify(plan.sources)!==JSON.stringify(sources)||!Array.isArray(plan.commands))fail();
 const store=path.join(repo,WALLET_PUBLISHER_NATIVE_INPUTS[1].path),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node');
 if(plan.output!==output||JSON.stringify(plan.outputs)!==JSON.stringify([output]))fail();
 const compilers=plan.commands.filter(c=>c.tool==='/usr/bin/clang++');
 if(compilers.length<1||compilers.length>2||plan.commands.length!==(compilers.length===2?3:1))fail();
 const commands=plan.commands.map(command=>{
  if(command.tool!=='/usr/bin/clang++'){
   if(command.tool!=='/usr/bin/lipo'||JSON.stringify(command.argv)!==JSON.stringify(['-create',output+'.arm64',output+'.x64','-output',output]))fail();
   return {...command,argv:[...command.argv]};
  }
  const argv=[...command.argv],start=argv.indexOf(sources[0]),end=argv.lastIndexOf('-o');
  if(start<0||end!==start+sources.length||JSON.stringify(argv.slice(start,end))!==JSON.stringify(sources)||argv.includes(store)||argv.includes('LocalAuthentication'))fail();
  if(argv.filter(a=>a==='ServiceManagement').length!==1||argv.filter(a=>a==='AppKit').length!==1||argv.filter(a=>a==='-lbsm').length!==1)fail();
  argv.splice(end,0,store);argv.splice(argv.indexOf('-lbsm'),0,'-framework','LocalAuthentication');
  return {...command,argv};
 });
 return {...plan,sources:[...sources,store],commands,walletInputFiles:WALLET_PUBLISHER_NATIVE_INPUTS,supplierNodeInputCount,nativeGrant:false,approval:false};
}
