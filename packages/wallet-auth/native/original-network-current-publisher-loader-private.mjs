import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {originalNetworkCurrentPublisherRows} from './original-network-current-publisher-selection-private.mjs';
import {loadOriginalNetworkCurrentPublisherSelectedKeysV1} from '../src/original-auth-source-current-v2.js';
const error=code=>Object.assign(Error(code),{code});
// Sole normal entry. Static release commissioning supplies the entire entry;
// HTTP/DTO/ENV/renderer input cannot select profiles, nodes, keys or modules.
export async function acquireOriginalNetworkResourceCurrentPublisherNormalV1(){
 if(arguments.length)throw error('NETWORK_CURRENT_ZERO_INPUT');
 if(originalNetworkCurrentPublisherRows.length!==1)return Object.freeze({owner:null,errorPresent:true,error:error('NETWORK_CURRENT_NO_ROOT_SELECTION'),RootAdmission:false});
 const row=originalNetworkCurrentPublisherRows[0],entry=row.loaderEntry;
 if(!entry||typeof row.loaderEntryDigest!=='string'||sha(canonical(entry))!==row.loaderEntryDigest)return Object.freeze({owner:null,errorPresent:true,error:error('NETWORK_PUBLISHER_LOADER_ENTRY_NOT_SELECTED'),RootAdmission:false});
 // Publisher branch never uses readPublic: original protected capture supplies
// its Root4 and the compiled row pins them before private key IO.
 try{const owner=await loadOriginalNetworkCurrentPublisherSelectedKeysV1(entry);
  if(owner&&Object.hasOwn(owner,'error'))return Object.freeze({owner:owner.partial??null,errorPresent:true,error:owner.error,RootAdmission:false});
  return Object.freeze({owner,errorPresent:false,error:null,RootAdmission:false});
 }catch(cause){return Object.freeze({owner:cause?.partial??null,errorPresent:true,error:cause,RootAdmission:false});}
}
