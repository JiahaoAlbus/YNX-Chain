import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readSDK49ProductRuntime} from './sdk49-product-runtime.mjs';
import {SDK49_DAEMON_PREFIX_INVENTORY} from './sdk49-runtime-source.mjs';
import {SDK49_DAEMON_VARIANT,SDK49_DAEMON_COMMIT,SDK49_DAEMON_TREE} from './sdk49-daemon-profile.mjs';
import {deviceV4PQSupplierInputs} from './wallet-device-v4-pq-role.mjs';
export const IDE49_DAEMON_COMPOSITION=Object.freeze({bytes:1936100,sha256:'ff53b3b052e004e064605850d1926d2acf114756057c0af1ab0fd08fd814e39b'});
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('WALLET_IDE49_DAEMON_SOURCE_COMPOSITION_DIFFERS');};
function pinned(b,p){if(!Buffer.isBuffer(b)||b.length!==p.bytes||sha(b)!==p.sha256)fail();return JSON.parse(b);}
function sameRows(left,right){
 const sorted=a=>a.map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 if(!isDeepStrictEqual(sorted(left),sorted(right)))fail();
}
function actual(root,row){
 const file=path.join(root,row.path),before=fs.lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||fs.realpathSync(file)!==file||before.size!==row.bytes)fail();
 const b=fs.readFileSync(file),after=fs.lstatSync(file);if(sha(b)!==row.sha256||['dev','ino','size','mtimeMs','ctimeMs','mode'].some(k=>before[k]!==after[k]))fail();
}
/** Source-only composition with the original IDE supplier. Prefix DATA must
 * separately pass verifySDK49NormalSource; this cannot qualify a component,
 * fill incoming nulls, install a service or grant a real account authority. */
export function bindIDE49DaemonSource({root,sourceCommit,compositionRaw,inventoryRaw}){
 const c=pinned(compositionRaw,IDE49_DAEMON_COMPOSITION),inventory=pinned(inventoryRaw,SDK49_DAEMON_PREFIX_INVENTORY),p=readSDK49ProductRuntime(root,sourceCommit);
 if(c.schema!=='YNX_IDE_PAIR_DAEMON_SOURCE_COMPOSITION_INPUT/v1'||c.sourceOnly!==true||c.sdkCommit!==SDK49_DAEMON_COMMIT||c.sdkTree!==SDK49_DAEMON_TREE||c.runtimeVariant!==SDK49_DAEMON_VARIANT||p?.public.sourceVariant!==SDK49_DAEMON_VARIANT)fail();
 if(['nativeComponent','helperComponent','matchingMainComposition','normalPlans'].some(k=>c[k]!==null)||['newRuntimeQualified','SourceAdmission','RootAdmission','installed'].some(k=>c[k]!==false))fail();
 if(c.files.length!==443||c.productFiles.length!==428||c.dependencies.length!==9184||c.generatedAliases.full.length!==2||c.generatedAliases.product.length!==2)fail();
 sameRows([...c.files,...c.dependencies],inventory.files);sameRows([...c.productFiles,...c.dependencies],[...p.selected.values()]);
 for(const[k,expected]of [['full',p.manifestRows.map(r=>({path:r.path.slice('code/packages/wallet-auth/'.length),bytes:r.originalBytes,sha256:r.originalSHA256}))],['product',p.manifestRows.map(r=>({path:r.path.slice('code/packages/wallet-auth/'.length),bytes:r.bytes,sha256:r.sha256}))]])sameRows(c.generatedAliases[k].map(r=>({...r,path:r.destination})),expected);
 const native=JSON.parse(fs.readFileSync(path.join(root,'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json')));
 sameRows(c.nativeSources,native.NativeInputs);sameRows(c.helperSources,native.HelperInputs);
 const projected=deviceV4PQSupplierInputs(c.nativeSources);
 for(const row of [...projected,...c.helperSources,...c.sourceCurrentIO,...c.pureInputs,c.normalBuildTool])actual(root,row);
 for(const row of c.separateUncompiledRootStorageSources){const name=path.basename(row.path);if(!['original-source-root-dirfd-node.cpp','original-source-root-dirfd-journal.h'].includes(name))fail();actual(root,{...row,path:'packages/wallet-auth/native/'+name});}
 return Object.freeze({kind:'YNX_WALLET_IDE49_DAEMON_MATCHED_SOURCE/v1',sdkCommit:c.sdkCommit,sdkTree:c.sdkTree,runtimeVariant:c.runtimeVariant,fullSourceWithAliases:445,productSourceWithAliases:430,dependencies:9184,nativeSourceInputs:117,helperSourceInputs:5,sourceCurrentIOInputs:1,pureInputs:4,normalBuildToolMatched:true,MainNodeProjectionMatched:true,separateRootStorageSources:2,nativeComponent:null,helperComponent:null,matchingMainComposition:null,normalPlans:null,newRuntimeQualified:false,NativeAdmission:false,SourceAdmission:false,RootAdmission:false,installed:false});
}
