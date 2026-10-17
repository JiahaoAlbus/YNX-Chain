import {originalIDEServiceAdmissionStartupSelection} from '../scripts/original-ide-service-admission-native-selection.mjs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
const requireNative=createRequire(import.meta.url);
const fail=code=>{throw Object.assign(Error('Original private IDE parent admission is unavailable'),{code});};
/** Actual fixedvendor Node caller, not renderer/ENV/project selection.
 * The fixed null branch never loads the original protected/crypto graph.
 * Installed receipt validation remains in prepareOriginalIDEServiceAdmissionStartup;
 * it MUST NOT be promoted into approval of an OS parent or its executor.
 * Configured callers select only the original Native acquisition implementation.
 * Native alone verifies Source/joint authority and completes the exclusive
 * prelude before returning. Its exact owner, including partial cleanup custody,
 * is returned unchanged; this adapter neither reads fd4 nor mints a guard. */
export async function acquireOriginalIDEAdmissionParentDelivery(actualEntryURL){
  if(originalIDEServiceAdmissionStartupSelection===null)return null;
  if(typeof actualEntryURL!=='string')fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
  let entry;
  try{const url=new URL(actualEntryURL);if(url.protocol!=='file:'||url.host||url.search||url.hash)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');entry=fileURLToPath(url);}catch{fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');}
  if(resolve(entry)!==entry||entry!==join(dirname(entry),'server.mjs')||typeof process.argv[1]!=='string'||resolve(process.argv[1])!==entry)fail('IDE_ADMISSION_RUNNING_ENTRY_MISMATCH');
  const native=requireNative(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',import.meta.url)));
  if(typeof native.acquireOriginalIDEAdmissionParentDelivery!=='function')fail('IDE_ORIGINAL_PARENT_QUALIFICATION_NOT_SUPPLIED');
  // Do not inspect/current/close the returned owner here: partial acquisition
  // must remain reachable by the existing consumer's cleanup-only lifecycle.
  // No retry, alternate module, Socket or installed-frame read belongs here.
  return native.acquireOriginalIDEAdmissionParentDelivery(actualEntryURL);
}
