import path from 'node:path';
import {pqNativeWalletInputs,composePQNativeCommands,PQ_NATIVE_PROVENANCE} from './wallet-pq-native-build.mjs';
export const WALLET_NATIVE_SOURCE_PROFILES=Object.freeze({
 '1.3.0-pq.3.32-auth.13':Object.freeze({version:'1.3.0-pq.3.32-auth.13',supplierNodeInputs:69,inventory:Object.freeze({bytes:30418,sha256:'3d256c3c4581748448026d53bfd8160be1e00b80733b3d4c03af5ad30fb68a3c'}),tool:Object.freeze({bytes:10764,sha256:'ae074c5d82d29c2b10a5ef0a55947ccc8a4a127745308a464c8c465035e0ee81'})}),
 '1.3.0-pq.3.32-auth.14':Object.freeze({version:'1.3.0-pq.3.32-auth.14',supplierNodeInputs:71,inventory:Object.freeze({bytes:34752,sha256:'feafd827a9d42cea65af17b94944e6c565b8ef4b1e6eb56c938709811cc1eadf'}),tool:Object.freeze({bytes:10932,sha256:'c532946f53a6314d9c0ecb2ffb3afd2044f9ffb1961afbfe0b8ec32444f71461'})}),
 '1.3.0-pq.3.32-auth.18':Object.freeze({version:'1.3.0-pq.3.32-auth.18',supplierNodeInputs:75,inventory:Object.freeze({bytes:45891,sha256:'de4028e5ef58287c954c31c46b4e944828ae3e42712892eda3be6d659c44fbad'}),tool:Object.freeze({bytes:11989,sha256:'218c73f9883ef9263181453a7e12049009ccc400ec313e85c29ece3848ebc4dc'})}),
 '1.3.0-pq.3.32-auth.19':Object.freeze({version:'1.3.0-pq.3.32-auth.19',supplierNodeInputs:76,inventory:Object.freeze({bytes:48913,sha256:'faf4ab0694a4ecdf1b1e31ad69239ac038a02c2abf165e5e940da6222334e01d'}),tool:Object.freeze({bytes:12230,sha256:'06b86ae2cb60cd750623e790214a2698671315987c67ce4603871b413d5debdc'})}),
 '1.3.0-pq.3.32-auth.20':Object.freeze({version:'1.3.0-pq.3.32-auth.20',supplierNodeInputs:77,inventory:Object.freeze({bytes:51343,sha256:'408042f992ecbf4904e3677e4bb503e65ab6fb56990743adc1b19540829b9ea4'}),tool:Object.freeze({bytes:12387,sha256:'882c936591a31fed919cadb063a5d496182d82175cc80a80dbaaaf6d109e179e'})}),
 '1.3.0-pq.3.32-auth.23':Object.freeze({version:'1.3.0-pq.3.32-auth.23',supplierNodeInputs:82,inventory:Object.freeze({bytes:60578,sha256:'aafecb4804cdbe1c4c23cb8931cb495215142ec25d6890f5e8d850220da8b89c'}),tool:Object.freeze({bytes:13487,sha256:'c78a2448c9892a9943051bc7c5409f473f2a2838a11a165e908754ccd3090adf'})}),
 '1.3.0-pq.3.32-auth.26':Object.freeze({version:'1.3.0-pq.3.32-auth.26',supplierNodeInputs:91,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:73355,sha256:'ea01d04aa23788438efe349d9ddcfedaadd1865d2612553585a73d20ccf99c48'}),tool:Object.freeze({bytes:14606,sha256:'219d5e0435c216ce5e78a556843d9bbcfe2be5dc321cd6dc4a8a0883507c0aee'})}),
 '1.3.0-pq.3.32-auth.28':Object.freeze({version:'1.3.0-pq.3.32-auth.28',supplierNodeInputs:91,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:73355,sha256:'197dafc43bb8ab8c6de68aae0ba50b9a7f8cf5a48553e8a8c550ec4e794e21cd'}),tool:Object.freeze({bytes:14606,sha256:'219d5e0435c216ce5e78a556843d9bbcfe2be5dc321cd6dc4a8a0883507c0aee'})}),
 '1.3.0-pq.3.32-auth.31':Object.freeze({version:'1.3.0-pq.3.32-auth.31',supplierNodeInputs:92,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:73563,sha256:'c598c7f7541c6854885c5c227315cd9215a7aeefa3e1d1f23192bcd7acf72dbb'}),tool:Object.freeze({bytes:14702,sha256:'83db7b575e57ceb67cf59efdc767c6988d30eb075877dca44ea55c003888e6be'})}),
 '1.3.0-pq.3.32-auth.32':Object.freeze({version:'1.3.0-pq.3.32-auth.32',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:76220,sha256:'20cf1f242571d679028539b5201591bc274d5f6ca710a608342f9d57605e5ead'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.33':Object.freeze({version:'1.3.0-pq.3.32-auth.33',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:76890,sha256:'5113796025da9449eb495d3a606131e0a181190b099332e67dd5199762f86288'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.34':Object.freeze({version:'1.3.0-pq.3.32-auth.34',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:77711,sha256:'e254e16291fb8c7a115937f950ef8b14276df1198234a1f2c838148a748c7d2d'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.35':Object.freeze({version:'1.3.0-pq.3.32-auth.35',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:78970,sha256:'fcecccb00a1eb7deb9014588bc51750c7d07dab7a778635895eca9537623b366'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.36':Object.freeze({version:'1.3.0-pq.3.32-auth.36',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:80385,sha256:'b262f8447437696dc84a0d51005e007be7690e0a30e1c40bf0f66ce871955068'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.37':Object.freeze({version:'1.3.0-pq.3.32-auth.37',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:80944,sha256:'db3a0780fbf8af5203609ed8f0170a3fe09679ef472c755d7b904314800fe561'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.38':Object.freeze({version:'1.3.0-pq.3.32-auth.38',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:81727,sha256:'e46ede40180fb2e20b31064cf0ffd43afb2abf3c346d7d9beadcb97c8f57d0d6'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.39':Object.freeze({version:'1.3.0-pq.3.32-auth.39',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:82436,sha256:'b05021cf660e74dd7669875f82c4535ee26bbd1aa8f9731f9390640fa1d870dd'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.40':Object.freeze({version:'1.3.0-pq.3.32-auth.40',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:82700,sha256:'b5677d6dd27f9a20b07043102169c09f7a230d3ceda23e2ea7954a95f27c83f0'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.41':Object.freeze({version:'1.3.0-pq.3.32-auth.41',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:83059,sha256:'164d888911e3b24e3a2a66615e6e081e68d00e12686defbe0260d47913d1328c'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.42':Object.freeze({version:'1.3.0-pq.3.32-auth.42',supplierNodeInputs:99,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:83059,sha256:'7a19292ee90a48e17cf3a3fcf5d849dedb3a421ca065b87f419b0481bc7a8d12'}),tool:Object.freeze({bytes:15467,sha256:'d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480'})}),
 '1.3.0-pq.3.32-auth.46':Object.freeze({version:'1.3.0-pq.3.32-auth.46',supplierNodeInputs:100,requiresRuntimeUnion:true,inventory:Object.freeze({bytes:84691,sha256:'653b1ec3d1d8aac77fd599245de57501864072536a3af7fade722f449b09389e'}),tool:Object.freeze({bytes:15553,sha256:'332bfa52666aa59b1d1d5c39eb5d11c0d539e57411a2371ccea65a4685357622'})})
});
export function walletNativeSourceProfile(version){if(typeof version!=='string'||!Object.hasOwn(WALLET_NATIVE_SOURCE_PROFILES,version))throw Error('WALLET_NATIVE_MATCHED_SDK_REQUIRED');return WALLET_NATIVE_SOURCE_PROFILES[version];}
export const WALLET_PUBLISHER_NATIVE_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.h',bytes:7531,sha256:'b080715fad16eee2beed9fb4967c44d645c02f7ccdfecb983b97b6bc3c6ee07f'},
 {path:'apps/wallet-desktop/native/original-artifact-publisher-store.mm',bytes:49667,sha256:'eae82496ffc185bcf37f5eddabb53c30664d593b8a5be295b95484d097ec3c90'}
].map(Object.freeze));
export const WALLET_PUBLISHER_APPROVAL_FLAG='-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1';
export const WALLET_PUBLISHER_APPROVAL_INPUT=Object.freeze({path:'apps/wallet-desktop/native/original-artifact-publisher-binding.inc.mm',bytes:17154,sha256:'bd2b7aae7bbd108b2c2775f19e1621e9617fc19d70c2e9bad9fd576ee71d299d'});
export const WALLET_PROJECT_CONTROL_FLAG='-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL=1';
export const WALLET_PROJECT_CONTROL_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-project-control-journal.h',bytes:705,sha256:'f2ce1185a38a3e534dcc0478eb0fddae04839cb8b3b4377fffc3c7cff8a5dd28'},
 {path:'apps/wallet-desktop/native/original-project-control-journal.mm',bytes:4783,sha256:'fa02c314dd925d0bd5ae3a7e636cf58c682be9a8adc8a434354dd88995c981e6'},
 {path:'apps/wallet-desktop/native/original-project-control-review.h',bytes:2075,sha256:'884af35345d974b0ec168daec93ee77e9464f40aed9a8a18c340d39ffaa6f332'},
 {path:'apps/wallet-desktop/native/original-project-control-review.mm',bytes:41421,sha256:'d6f8ab5647912e52a03a011c064ddc5c88be7f9a869184f019919e631690ac8f'},
 {path:'apps/wallet-desktop/native/original-project-control-binding.inc.mm',bytes:10298,sha256:'49c95e1be1d0849dff878ddbb0e19fd9ee86d8a481b8998a4f57daff5e7feada'}
].map(Object.freeze));
// Exact separate role inputs for the R201 matching supplier successor. This
// does NOT enable the role in old SDK23/24 recipes or lend their Native record.
// A must freeze the new supplier TU/inventory before composing this role.
export const WALLET_PROJECT_CONTROL_CABI_FLAG='-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI=1';
export const WALLET_PROJECT_CONTROL_CABI_INPUTS=Object.freeze([
 {path:'apps/wallet-desktop/native/original-project-control-cabi.h',bytes:4180,sha256:'a85524f65a20dbeb01d8c79ce2ce98636736e54b9605e0fc4843a593bc87bc96'},
 {path:'apps/wallet-desktop/native/ynx_project_control.h',bytes:4420,sha256:'98c4f5fa607d6a1e87b5ea091c7110288aee7f8ac9ff5a901f98e1c2990ca5af'},
 {path:'apps/wallet-desktop/native/libynx_project_control.a',bytes:7588424,sha256:'9ec0b0ebe0e979afa701a483985c7e4ed19757c582b1479de2c7b9701ad3ceb9'}
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
export function walletPublisherNativeInputs(supplierNodeInputCount,artifactRelease=false,projectControl=false,controlCABI=false,pqNative=false){
 if(typeof pqNative!=='boolean'||pqNative&&![99,100].includes(supplierNodeInputCount))throw Error('WALLET_PQ_NATIVE_MATCHED_SDK42_OR_46_REQUIRED');
 if(typeof controlCABI!=='boolean'||controlCABI&&(!projectControl||![91,92,99,100].includes(supplierNodeInputCount)))throw Error('WALLET_CONTROL_CABI_MATCHED_SDK26_REQUIRED');
 if(typeof projectControl!=='boolean'||projectControl&&![77,82,91,92,99,100].includes(supplierNodeInputCount))throw Error('WALLET_CONTROL_MATCHED_SDK20_OR_23_OR_26_REQUIRED');
 if(typeof artifactRelease!=='boolean')throw Error('WALLET_ARTIFACT_CABI_ROLE_INVALID');
 if(artifactRelease&&![77,91,92,99,100].includes(supplierNodeInputCount))throw Error('WALLET_ARTIFACT_CABI_SDK20_REQUIRED');
 if(![69,71,75,76,77,82,91,92,99,100].includes(supplierNodeInputCount))throw Error('WALLET_PUBLISHER_NATIVE_PLAN_MISMATCH');
 const selected=artifactRelease&&supplierNodeInputCount===77?withCABI:[77,82,91,92,99,100].includes(supplierNodeInputCount)?withApproval:WALLET_PUBLISHER_NATIVE_INPUTS;
 // The new archive co-resides both ABIs. Combined roles retain BOTH fixed
 // headers/adapters, but NEVER also link the historical Go runtime archive.
 return Object.freeze(pqNativeWalletInputs([...selected,...(projectControl?WALLET_PROJECT_CONTROL_INPUTS:[]),...(controlCABI?WALLET_PROJECT_CONTROL_CABI_INPUTS:[]),...(artifactRelease&&[91,92,99,100].includes(supplierNodeInputCount)?[...WALLET_ARTIFACT_CABI_INPUTS.slice(0,2),...(controlCABI?[]:[WALLET_PROJECT_CONTROL_CABI_INPUTS[2]])]:[])],pqNative));
}
export const SDK13_NODE_TRANSLATION_UNITS=Object.freeze([
 'apps/wallet-desktop/native/original-auth-identity-node.mm',
 ...['original-auth-identity-source-authority.mm','original-auth-identity-joint-owner.mm','original-ide-parent-source-binding.mm','original-ide-parent-kernel.mm','original-ide-parent-node.mm','original-ide-wallet-identity-source.mm','original-ide-wallet-peer-launch.mm','original-ide-helper-client.mm','original-ide-helper-xpc-peer.mm','original-ide-helper-service-install.mm','original-ide-publication-artifact.mm','original-ide-contract-relay-owner.mm'].map(n=>'packages/wallet-auth/native/'+n)
]);
export const SDK26_NODE_TRANSLATION_UNITS=Object.freeze([...SDK13_NODE_TRANSLATION_UNITS,'packages/wallet-auth/native/original-ide-project-control-custody.mm']);
export const SDK32_NODE_TRANSLATION_UNITS=Object.freeze([...SDK26_NODE_TRANSLATION_UNITS.slice(0,6),'packages/wallet-auth/native/original-pq-host-catalog-source.mm',...SDK26_NODE_TRANSLATION_UNITS.slice(6)]);
const fail=()=>{throw Error('WALLET_PUBLISHER_NATIVE_PLAN_MISMATCH');};
/** Build-only composition. Original supplier bytes and helper recipe remain
 * unchanged. This extra private IO class is NOT Source/approval qualification.
 */
export function composeWalletPublisherNativeBuildPlan(plan,repo,supplierNodeInputCount=69,artifactRelease=false,projectControl=false,controlCABI=false,pqNative=false){
 if(typeof repo!=='string'||!path.isAbsolute(repo)||path.normalize(repo)!==repo)fail();
 const walletInputs=walletPublisherNativeInputs(supplierNodeInputCount,artifactRelease,projectControl,controlCABI,pqNative),withCustody=[91,92,99,100].includes(supplierNodeInputCount);
 const controlSources=projectControl?WALLET_PROJECT_CONTROL_INPUTS.filter(p=>p.path.endsWith('.mm')&&!p.path.endsWith('.inc.mm')).map(p=>path.join(repo,p.path)):[];
 const sources=([99,100].includes(supplierNodeInputCount)?SDK32_NODE_TRANSLATION_UNITS:withCustody?SDK26_NODE_TRANSLATION_UNITS:SDK13_NODE_TRANSLATION_UNITS).map(n=>path.join(repo,n));
 if(plan.minimumSystemVersion!=='13.0'||JSON.stringify(plan.sources)!==JSON.stringify(sources)||!Array.isArray(plan.commands))fail();
 const store=path.join(repo,WALLET_PUBLISHER_NATIVE_INPUTS[1].path),output=path.join(repo,'apps/wallet-desktop/native/original-auth-identity.node');
 if(plan.output!==output||JSON.stringify(plan.outputs)!==JSON.stringify([output]))fail();
 const compilers=plan.commands.filter(c=>c.tool==='/usr/bin/clang++');
 if((artifactRelease||controlCABI||pqNative)&&(compilers.length!==1||compilers[0].argv.filter(v=>v==='-arch').length!==1||compilers[0].argv[compilers[0].argv.indexOf('-arch')+1]!=='arm64'))throw Error('WALLET_ARTIFACT_CABI_ARCHITECTURE_NOT_SUPPLIED');
 if(compilers.length<1||compilers.length>2||plan.commands.length!==(compilers.length===2?3:1))fail();
 const commands=plan.commands.map(command=>{
  if(command.tool!=='/usr/bin/clang++'){
   if(command.tool!=='/usr/bin/lipo'||JSON.stringify(command.argv)!==JSON.stringify(['-create',output+'.arm64',output+'.x64','-output',output]))fail();
   return {...command,argv:[...command.argv]};
  }
  const argv=[...command.argv],start=argv.indexOf(sources[0]),end=argv.lastIndexOf('-o');
  if(argv.some(a=>a.includes('YNX_ORIGINAL_WALLET_PROJECT_CONTROL')||a.includes('YNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING')||a.includes('YNX_ORIGINAL_WALLET_ARTIFACT_CABI')||a.includes('libynx_artifact_release')||a.includes('libynx_project_control')))fail();
  const la=argv.indexOf('LocalAuthentication');
  if(start<0||end!==start+sources.length||JSON.stringify(argv.slice(start,end))!==JSON.stringify(sources)||argv.includes(store)||withCustody&&(argv.filter(a=>a==='LocalAuthentication').length!==1||argv[la-1]!=='-framework'||argv[la+1]!=='-lbsm')||!withCustody&&la!==-1)fail();
  if(argv.filter(a=>a==='ServiceManagement').length!==1||argv.filter(a=>a==='AppKit').length!==1||argv.filter(a=>a==='-lbsm').length!==1)fail();
  argv.splice(end,0,store,...controlSources);if(!withCustody)argv.splice(argv.indexOf('-lbsm'),0,'-framework','LocalAuthentication');
  if(artifactRelease||controlCABI||pqNative){const archive=pqNative?walletInputs.find(p=>p.path.endsWith('.a')):withCustody?WALLET_PROJECT_CONTROL_CABI_INPUTS[2]:WALLET_ARTIFACT_CABI_INPUTS[2];argv.splice(argv.lastIndexOf('-o'),0,path.join(repo,archive.path));argv.unshift('-I'+path.join(repo,'apps/wallet-desktop/native'));}
  if(artifactRelease)argv.unshift(WALLET_ARTIFACT_CABI_FLAG);
  if([77,82,91,92,99,100].includes(supplierNodeInputCount))argv.unshift(WALLET_PUBLISHER_APPROVAL_FLAG);
  if(projectControl)argv.unshift(WALLET_PROJECT_CONTROL_FLAG);
  if(controlCABI)argv.unshift(WALLET_PROJECT_CONTROL_CABI_FLAG);
  return {...command,argv};
 });
 const role=pqNative?composePQNativeCommands(commands,repo):null;
 return {...plan,sources:[...sources,store,...controlSources],commands:role?.commands??commands,...(role?{pqNativeRole:PQ_NATIVE_PROVENANCE,pqNativeBaseCommands:commands,intermediateOutputs:role.intermediateOutputs}:{}),walletInputFiles:walletInputs,supplierNodeInputCount,nativeGrant:false,approval:false};
}
