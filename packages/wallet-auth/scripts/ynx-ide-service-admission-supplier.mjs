// This module imports ONLY the fixed owner selection. With null selection it
// never evaluates/imports the protected-startup/crypto runtime graph.
import {originalIDEServiceAdmissionStartupSelection} from './original-ide-service-admission-native-selection.mjs';
export {acquireOriginalIDEAdmissionParentDelivery} from '../src/original-ide-admission-parent-delivery.js';
function notSupplied(){return Object.freeze({assertCurrent(){throw Object.assign(new Error('Wallet service admission is not supplied.'),{code:'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'});}});}
// Original private backend passes its OWN Resources/server.mjs import.meta.url.
// No frontend/ENV/flag chooses rights or causes loading of configured authority.
export async function openOriginalIDEServiceAdmissionSupplier(runningBackendModuleURL){
 const selection=originalIDEServiceAdmissionStartupSelection;
 if(selection===null)return notSupplied();
 // A genuine selection is NOT permission to execute a tool-rejected graph.
 // This normal configured branch retains the complete original validation and
 // is used only by the original lawfully permitted application executor.
 const {prepareOriginalIDEServiceAdmissionStartup}=await import('../src/original-ide-service-admission-startup.js');
 return prepareOriginalIDEServiceAdmissionStartup(selection,runningBackendModuleURL,()=>new Date());
}
