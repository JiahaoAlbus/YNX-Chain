import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {verifyPhysicalPin} from './next-product-supplier-input.mjs';

const root='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-control-matched-whole-cohort-successor-20261108';
export const CONTROL_MATCHED_HANDOFF=Object.freeze({path:root+'/HANDOFF.json',bytes:29080,sha256:'cafb11a58caff277d5ae2e0e31ba79720a387a500c7f48440ed876f8699a8270'});
export const CONTROL_MATCHED_VARIANT='SDK49-IDE-CONTROL-MATCHED-WHOLE-SOURCE-ARCHIVE-RUNTIME/v1';
const nodeRoles=Object.freeze({CPPBase:'3c9ead1f8a5920fb2428553dfed4e6943f882968',SwiftBase:'c6af5521c96433f44b5fa91597fb30415a47c1d6',originalFiniteNAPIProducer:'86d0d24c052843516c6cf79e2fe2ee859d43358a',projectControlSource:'4a807cdc6e09c25467f06cc912a655a294ccc975',NodeOriginalSourceUnchanged:true,NodeCompileClosureChanged:true});
export function matchedNodePackageSourceRoles(contract){
 const n=contract.matchedNode;
 if(contract.schema!=='YNX_IDE_CONTROL_MATCHED_WHOLE_NORMAL_PRODUCT/v1'||contract.NativeBuildOrRelinkRequested!==false||contract.SDKResourceOnlySuccessor!==true||!isDeepStrictEqual(n?.sourceRoles,nodeRoles)||n.record?.bytes!==46291||n.record.sha256!=='cb77be5f4f015a722254f5e9869a35e985fe0e8c238e0ca1efed906e7ff48c32'||n.record.relative!=='apps/wallet-desktop/native/NORMAL_WALLET_PROJECT_CONTROL_MATCHING_RECORD.json'||n.image?.bytes!==15917120||n.image.sha256!=='6e180505fe4c7c646bfa427162e607a10385ca8865d3f8b7e37f5ccc0aa2771d'||contract.roles?.CocoaCompiledSDK!=='98956ed2bbac8bb5c86de83c4f1df24314e19bf0'||contract.roles?.CocoaCPPBase!==nodeRoles.CPPBase)throw Error('Exact separate matched Node and inherited Cocoa source roles required');
 return {matchedNodeSourceRoles:{...nodeRoles},matchedNodeRecord:{...n.record},matchedNodeImage:{...n.image},CocoaCompiledSDK:contract.roles.CocoaCompiledSDK,compiledCocoaNativeSourceCommit:contract.roles.CocoaCPPBase};
}
// A fixed build-input reader, never a caller-selected runtime provider.
export async function controlMatchedInput(){
 await verifyPhysicalPin(CONTROL_MATCHED_HANDOFF);
 const h=JSON.parse(await readFile(CONTROL_MATCHED_HANDOFF.path));
 if(h.schema!=='YNX_IDE_CONTROL_MATCHED_WHOLE_NORMAL_INPUT_HANDOFF/v1'||h.privateSupplierSource?.commit!=='3bfaec83dc2a56b013ee8df1a580704c20a5ab9b'||h.RootAdmission!==false||h.SourceAdmission!==false||h.NativeLoadedHere!==false||h.normalEntry?.export!=='readControlMatchedCohortInput')throw Error('Exact matched whole supplier required');
 for(const row of[h.sourceFiles,h.normalEntry.module,h.fixedInputManifest,h.contract,h.normalProducer,h.P03LoaderOverlay.CAS,h.P03LoaderOverlay.after])await verifyPhysicalPin(row);
 const inventory=JSON.parse(await readFile(h.sourceFiles.path));
 if(inventory.privateSupplierCodeCommit!==h.privateSupplierSource.commit||inventory.privateSupplierCodeTree!==h.privateSupplierSource.tree||!Array.isArray(inventory.files)||!inventory.files.length)throw Error('Matched supplier source identity differs');
 const seen=new Set();
 for(const row of inventory.files){if(typeof row.relative!=='string'||row.path!==join(root,row.relative)||!row.path.startsWith(root+'/')||seen.has(row.path))throw Error('Matched supplier source escaped or duplicated');seen.add(row.path);await verifyPhysicalPin(row);}
 if(dirname(h.normalEntry.module.path)!==root)throw Error('Matched normal entry escaped');
 const reader=await import(pathToFileURL(h.normalEntry.module.path));
 const input=await reader.readControlMatchedCohortInput();
 matchedNodePackageSourceRoles(input.contract);
 return input;
}
