import {originalIDEServiceAdmissionStartupSelection} from '../scripts/original-ide-service-admission-native-selection.mjs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
const fail=code=>{throw Object.assign(Error('Original private IDE parent admission is unavailable'),{code});};
/** Actual fixedvendor Node caller, not renderer/ENV/project selection.
 * The fixed null branch never loads the original protected/crypto graph.
 * Installed receipt validation remains in prepareOriginalIDEServiceAdmissionStartup;
 * it MUST NOT be promoted into approval of an OS parent or its executor.
 * No native-callable parent qualification ABI exists in the original inputs.
 * Consequently a configured service selection also cannot mint an fd4 guard.
 * This is a precise missing native source dependency, not inferred admission. */
export async function acquireOriginalIDEAdmissionParentDelivery(actualEntryURL){
  if(originalIDEServiceAdmissionStartupSelection===null)return null;
  if(typeof actualEntryURL!=='string')fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
  let entry;
  try{const url=new URL(actualEntryURL);if(url.protocol!=='file:'||url.host||url.search||url.hash)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');entry=fileURLToPath(url);}catch{fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');}
  if(resolve(entry)!==entry||entry!==join(dirname(entry),'server.mjs')||typeof process.argv[1]!=='string'||resolve(process.argv[1])!==entry)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
  // DO NOT use getppid/fstat(fd4)/path/SHA as an approval or return a structural
  // descriptor. The original IDE native owner must supply its actual private
  // qualification ABI before a successful acquisition branch can be linked.
  fail('IDE_ORIGINAL_PARENT_QUALIFICATION_NOT_SUPPLIED');
}
