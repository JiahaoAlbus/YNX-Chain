import path from 'node:path';
export const WALLET_PUBLISHER_NATIVE_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.h',bytes:1023,sha256:'8b709ee2bc54dfef8e58380b1442714a5cf392e90ee15875c0e077b7efee6f54'},
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.mm',bytes:7027,sha256:'522f2fb036d4d4c54a5f1c1a056d9ffdc789b2786a764037d193f0022e759e35'}
].map(Object.freeze));
export const SDK13_NODE_TRANSLATION_UNITS=Object.freeze([
 'apps/wallet-desktop/native/original-auth-identity-node.mm',
 ...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.mm','original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-ide-publication-artifact.mm','original-ide-contract-relay-owner.mm'].map(n=>'packages/wallet-auth/native/'+n)
]);
const fail=()=>{throw Error('WALLET_PUBLISHER_NATIVE_PLAN_MISMATCH');};
/** Build-only composition. Original supplier bytes and helper recipe remain
 * unchanged. This extra private IO class is NOT Source/approval qualification.
 */
export function composeWalletPublisherNativeBuildPlan(plan,repo){
 if(typeof repo!=='string'||!path.isAbsolute(repo)||path.normalize(repo)!==repo)fail();
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
 return {...plan,sources:[...sources,store],commands,walletInputFiles:WALLET_PUBLISHER_NATIVE_INPUTS,supplierNodeInputCount:69,nativeGrant:false,approval:false};
}
