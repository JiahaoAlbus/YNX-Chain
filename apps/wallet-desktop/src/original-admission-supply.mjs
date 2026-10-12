// Fixed original main source slot, never ENV, renderer, IPC or user paths.
// No independent ROLE/registered Gateway/protected IDE executor has been
// supplied. Keeping null does not disable standalone Wallet/account features.
const originalAdmissionConfiguration=null;
export async function openOriginalAdmissionSupply(vault){
  if(originalAdmissionConfiguration===null)return null;
  const configured=originalAdmissionConfiguration;
  // Future provisioning must be an original owner source change with exact
  // protected executor/parent qualification, not a path/hash self-approval.
  if(configured.vault!==vault||typeof configured.assertCurrent!=='function'||typeof configured.assertExecutorCurrent!=='function'||typeof configured.assertAdmissionSuccession!=='function')throw Object.assign(Error('Original admission supply is not configured'),{code:'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED'});
  if(configured.assertCurrent()!==undefined||configured.assertExecutorCurrent(configured.executor,null)!==undefined)throw Object.assign(Error('Original admission custody changed'),{code:'ADMISSION_CURRENT_INVALID'});
  const {admissionCanonical}=await import('./original-admission-broker.mjs');
  const {assertOriginalServiceAdmissionProductionOwner,publishOriginalServiceAdmissionProduction,closeOriginalServiceAdmissionProductionOwner,completeOriginalServiceAdmissionProductionClose,enterOriginalServiceAdmissionDelivery,acknowledgeOriginalServiceAdmissionDelivery,markOriginalServiceAdmissionDeliveryUnknown}=await import('./original-admission-custodian.mjs');
  const raw=JSON.parse(admissionCanonical(configured.raw));
  const executor=JSON.parse(admissionCanonical(configured.executor));
  const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
  const supply=Object.freeze({vault,raw:freeze(raw),executor:freeze(executor),observer:configured.observer,assertCurrent:()=>configured.assertCurrent(),assertExecutorCurrent:(value,child)=>configured.assertExecutorCurrent(value,child),assertAdmissionSuccession:request=>configured.assertAdmissionSuccession(request),assertOriginalServiceAdmissionProductionOwner,publishOriginalServiceAdmissionProduction,closeOriginalServiceAdmissionProductionOwner,completeOriginalServiceAdmissionProductionClose,enterOriginalServiceAdmissionDelivery,acknowledgeOriginalServiceAdmissionDelivery,markOriginalServiceAdmissionDeliveryUnknown});
  if(supply.assertCurrent()!==undefined)throw Object.assign(Error('Original admission custody changed'),{code:'ADMISSION_CURRENT_INVALID'});
  return supply;
}
