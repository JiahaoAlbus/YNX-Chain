import path from 'node:path';
export const WALLET_NATIVE_SOURCE_PROFILES=Object.freeze({
 '1.3.0-pq.3.32-auth.13':Object.freeze({version:'1.3.0-pq.3.32-auth.13',supplierNodeInputs:69,inventory:Object.freeze({bytes:30418,sha256:'3d256c3c4581748448026d53bfd8160be1e00b80733b3d4c03af5ad30fb68a3c'}),tool:Object.freeze({bytes:10764,sha256:'ae074c5d82d29c2b10a5ef0a55947ccc8a4a127745308a464c8c465035e0ee81'})}),
 '1.3.0-pq.3.32-auth.14':Object.freeze({version:'1.3.0-pq.3.32-auth.14',supplierNodeInputs:71,inventory:Object.freeze({bytes:34752,sha256:'feafd827a9d42cea65af17b94944e6c565b8ef4b1e6eb56c938709811cc1eadf'}),tool:Object.freeze({bytes:10932,sha256:'c532946f53a6314d9c0ecb2ffb3afd2044f9ffb1961afbfe0b8ec32444f71461'})}),
 '1.3.0-pq.3.32-auth.18':Object.freeze({version:'1.3.0-pq.3.32-auth.18',supplierNodeInputs:75,inventory:Object.freeze({bytes:45891,sha256:'de4028e5ef58287c954c31c46b4e944828ae3e42712892eda3be6d659c44fbad'}),tool:Object.freeze({bytes:11989,sha256:'218c73f9883ef9263181453a7e12049009ccc400ec313e85c29ece3848ebc4dc'})}),
 '1.3.0-pq.3.32-auth.19':Object.freeze({version:'1.3.0-pq.3.32-auth.19',supplierNodeInputs:76,inventory:Object.freeze({bytes:48913,sha256:'faf4ab0694a4ecdf1b1e31ad69239ac038a02c2abf165e5e940da6222334e01d'}),tool:Object.freeze({bytes:12230,sha256:'06b86ae2cb60cd750623e790214a2698671315987c67ce4603871b413d5debdc'})}),
 '1.3.0-pq.3.32-auth.20':Object.freeze({version:'1.3.0-pq.3.32-auth.20',supplierNodeInputs:77,inventory:Object.freeze({bytes:51343,sha256:'408042f992ecbf4904e3677e4bb503e65ab6fb56990743adc1b19540829b9ea4'}),tool:Object.freeze({bytes:12387,sha256:'882c936591a31fed919cadb063a5d496182d82175cc80a80dbaaaf6d109e179e'})}),
 '1.3.0-pq.3.32-auth.23':Object.freeze({version:'1.3.0-pq.3.32-auth.23',supplierNodeInputs:82,inventory:Object.freeze({bytes:60578,sha256:'aafecb4804cdbe1c4c23cb8931cb495215142ec25d6890f5e8d850220da8b89c'}),tool:Object.freeze({bytes:13487,sha256:'c78a2448c9892a9943051bc7c5409f473f2a2838a11a165e908754ccd3090adf'})})
});
export function walletNativeSourceProfile(version){if(typeof version!=='string'||!Object.hasOwn(WALLET_NATIVE_SOURCE_PROFILES,version))throw Error('WALLET_NATIVE_MATCHED_SDK_REQUIRED');return WALLET_NATIVE_SOURCE_PROFILES[version];}
export const WALLET_PUBLISHER_NATIVE_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.h',bytes:6364,sha256:'f7231380d0674be6f843809bc123b66ea658af79edf04fa35be0404f35c223bd'},
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.mm',bytes:41258,sha256:'b5ddc4174abfe1959a4066d90fc8f28aa603a9a6c2d8f20520cf2ec66788552b'}
].map(Object.freeze));
export const WALLET_PUBLISHER_APPROVAL_FLAG='-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1';
export const WALLET_PUBLISHER_APPROVAL_INPUT=Object.freeze({path:'apps/wallet-desktop/native/original-artifact-publisher-binding.inc.mm',bytes:17154,sha256:'bd2b7aae7bbd108b2c2775f19e1621e9617fc19d70c2e9bad9fd576ee71d299d'});
export const WALLET_PROJECT_CONTROL_FLAG='-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL=1';
export const WALLET_PROJECT_CONTROL_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-project-control-journal.h',bytes:705,sha256:'f2ce1185a38a3e534dcc0478eb0fddae04839cb8b3b4377fffc3c7cff8a5dd28'},
 {path:'apps/wallet-desktop/native/original-project-control-journal.mm',bytes:4783,sha256:'fa02c314dd925d0bd5ae3a7e636cf58c682be9a8adc8a434354dd88995c981e6'},
 {path:'apps/wallet-desktop/native/original-project-control-review.h',bytes:1867,sha256:'2983c54e267d822710b1eabc8176e95bd5e5b5b034fe72001d4d566c229981e3'},
 {path:'apps/wallet-desktop/native/original-project-control-review.mm',bytes:28633,sha256:'3b494bc5bb78e2a3466d8ae643207c09879309b21118eb395ea9d5d0369d2957'},
 {path:'apps/wallet-desktop/native/original-project-control-binding.inc.mm',bytes:9665,sha256:'4e3492f8421340dd5cfe9b4a629835651e1d20496a22e5b25debb31dbff92dfc'}
].map(Object.freeze));
const withApproval=Object.freeze([...WALLET_PUBLISHER_NATIVE_INPUTS,WALLET_PUBLISHER_APPROVAL_INPUT]);
export const WALLET_ARTIFACT_CABI_FLAG='-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=1';
// Separate Main private body and unchanged Protocol 395bb8d99 darwin-arm64
// supply. These are explicit build inputs, never inferred from a local archive.
export const WALLET_ARTIFACT_CABI_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-artifact-publisher-cabi.h',bytes:4734,sha256:'f97eb8cafb4151113cd38a17a73a95d4534c1915986d1fa1ee15ada30964dd8a'},
 {path:'apps/wallet-desktop/native/ynx_artifact_release.h',bytes:5089,sha256:'1da905e0b38581ad34a9cf995c36f8d368425df9242a35f4e49d7b41c8100616'},
 {path:'apps/wallet-desktop/native/libynx_artifact_release.a',bytes:6994968,sha256:'c11e9522e0cfaf585987796a03e08b2acff99b5282c1c3622a65ad3b6211c643'}
].map(Object.freeze));
const withCABI=Object.freeze([...withApproval,...WALLET_ARTIFACT_CABI_INPUTS]);
export function walletPublisherNativeInputs(supplierNodeInputCount,artifactRelease=false,projectControl=false){
 if(typeof projectControl!=='boolean'||projectControl&&![77,82].includes(supplierNodeInputCount))throw Error('WALLET_CONTROL_MATCHED_SDK20_OR_23_REQUIRED');
 if(typeof artifactRelease!=='boolean')throw Error('WALLET_ARTIFACT_CABI_ROLE_INVALID');
 if(artifactRelease&&supplierNodeInputCount!==77)throw Error('WALLET_ARTIFACT_CABI_SDK20_REQUIRED');
 if(![69,71,75,76,77,82].includes(supplierNodeInputCount))throw Error('WALLET_PUBLISHER_NATIVE_PLAN_MISMATCH');
 const selected=artifactRelease?withCABI:[77,82].includes(supplierNodeInputCount)?withApproval:WALLET_PUBLISHER_NATIVE_INPUTS;
 return projectControl?Object.freeze([...selected,...WALLET_PROJECT_CONTROL_INPUTS]):selected;
}
export const SDK13_NODE_TRANSLATION_UNITS=Object.freeze([
 'apps/wallet-desktop/native/original-auth-identity-node.mm',
 ...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.mm','original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-ide-publication-artifact.mm','original-ide-contract-relay-owner.mm'].map(n=>'packages/wallet-auth/native/'+n)
]);
const fail=()=>{throw Error('WALLET_PUBLISHER_NATIVE_PLAN_MISMATCH');};
/** Build-only composition. Original supplier bytes and helper recipe remain
 * unchanged. This extra private IO class is NOT Source/approval qualification.
 */
export function composeWalletPublisherNativeBuildPlan(plan,repo,supplierNodeInputCount=69,artifactRelease=false,projectControl=false){
 if(typeof repo!=='string'||!path.isAbsolute(repo)||path.normalize(repo)!==repo)fail();
 const walletInputs=walletPublisherNativeInputs(supplierNodeInputCount,artifactRelease,projectControl);
 const controlSources=projectControl?WALLET_PROJECT_CONTROL_INPUTS.filter(p=>p.path.endsWith('.mm')&&!p.path.endsWith('.inc.mm')).map(p=>path.join(repo,p.path)):[];
 const sources=SDK13_NODE_TRANSLATION_UNITS.map(n=>path.join(repo,n));
 if(plan.minimumSystemVersion!=='13.0'||JSON.stringify(plan.sources)!==JSON.stringify(sources)||!Array.isArray(plan.commands))fail();
 const store=path.join(repo,WALLET_PUBLISHER_NATIVE_INPUTS[1].path),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node');
 if(plan.output!==output||JSON.stringify(plan.outputs)!==JSON.stringify([output]))fail();
 const compilers=plan.commands.filter(c=>c.tool==='/usr/bin/clang++');
 if(artifactRelease&&(compilers.length!==1||compilers[0].argv.filter(v=>v==='-arch').length!==1||compilers[0].argv[compilers[0].argv.indexOf('-arch')+1]!=='arm64'))throw Error('WALLET_ARTIFACT_CABI_ARCHITECTURE_NOT_SUPPLIED');
 if(compilers.length<1||compilers.length>2||plan.commands.length!==(compilers.length===2?3:1))fail();
 const commands=plan.commands.map(command=>{
  if(command.tool!=='/usr/bin/clang++'){
   if(command.tool!=='/usr/bin/lipo'||JSON.stringify(command.argv)!==JSON.stringify(['-create',output+'.arm64',output+'.x64','-output',output]))fail();
   return {...command,argv:[...command.argv]};
  }
  const argv=[...command.argv],start=argv.indexOf(sources[0]),end=argv.lastIndexOf('-o');
  if(argv.some(a=>a.includes('YNX_ORIGINAL_WALLET_PROJECT_CONTROL')||a.includes('YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING')||a.includes('YNX_ORIGINAL_WALLET_ARTIFACT_CABI')||a.includes('libynx_artifact_release')))fail();
  if(start<0||end!==start+sources.length||JSON.stringify(argv.slice(start,end))!==JSON.stringify(sources)||argv.includes(store)||argv.includes('LocalAuthentication'))fail();
  if(argv.filter(a=>a==='ServiceManagement').length!==1||argv.filter(a=>a==='AppKit').length!==1||argv.filter(a=>a==='-lbsm').length!==1)fail();
  argv.splice(end,0,store,...controlSources);argv.splice(argv.indexOf('-lbsm'),0,'-framework','LocalAuthentication');
  if(artifactRelease){argv.splice(argv.lastIndexOf('-o'),0,path.join(repo,WALLET_ARTIFACT_CABI_INPUTS[2].path));argv.unshift(WALLET_ARTIFACT_CABI_FLAG,'-I'+path.join(repo,'apps/wallet-desktop/native'));}
  if([77,82].includes(supplierNodeInputCount))argv.unshift(WALLET_PUBLISHER_APPROVAL_FLAG);
  if(projectControl)argv.unshift(WALLET_PROJECT_CONTROL_FLAG);
  return {...command,argv};
 });
 return {...plan,sources:[...sources,store,...controlSources],commands,walletInputFiles:walletInputs,supplierNodeInputCount,nativeGrant:false,approval:false};
}
