// Consume the owner's precise lazy entry, never its protected-startup barrel.
// The retained fixed null selection does not configure or grant admission.
// Only Resources/server.mjs supplies its own location; the supplier compares
// configured targets with independently approved original owner material.
import * as supplier from '../../../packages/wallet-auth/scripts/ynx-ide-service-admission-supplier.mjs';
import { openOriginalParentDelivery } from './wallet-admission-delivery.mjs';
import { createRequire } from 'node:module';
import { pathToFileURL,fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function loadBundledContractMaterialBuilder(){
  const metadataURL=new URL('../../../packages/wallet-auth/package.json',import.meta.url),metadata=JSON.parse(await fs.readFile(metadataURL,'utf8'));
  if(metadata.name!=='@ynx-chain/wallet-auth')throw Object.assign(Error('Original bounded contract material builder is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  const root=await fs.realpath(path.dirname(fileURLToPath(metadataURL))),originalSDK=createRequire(metadataURL),entry=await fs.realpath(originalSDK.resolve('@ynx-chain/wallet-auth/pq-contract-deployment-material'));
  if(!entry.startsWith(root+path.sep))throw Object.assign(Error('Original bounded contract material builder is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  const original=await import(pathToFileURL(entry).href);
  if(typeof original.preparePQContractDeploymentMaterialData!=='function')throw Object.assign(Error('Original bounded contract material builder is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  return original.preparePQContractDeploymentMaterialData;
}

// Explicit backend acquisition only. Old installed SDKs remain unavailable;
// this never silently switches a package, initializes Relay or restores a
// shared Wallet session as project authorization.
export async function openBundledProjectContractClient({context, relayAuthority}) {
  if(typeof relayAuthority?.assertCurrent!=='function'||typeof relayAuthority?.createConnection!=='function')throw Object.assign(Error('Original project Wallet contract authority is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  const {openProjectContractClient} = await import('./wallet-contract-client.mjs');
  return openProjectContractClient({context, relayAuthority, createConnection:() => relayAuthority.createConnection()});
}

// Explicit, backend-only acquisition. expectedScope must come from the original
// signed Source selection; local directory IDs and AI leases cannot supply it.
// Both modules resolve through one fixed SDK instance (its private brand map).
export async function openBundledContractRelayAuthority({serverModuleURL,expectedScope,localContext}){
  const metadataURL=new URL('../../../packages/wallet-auth/package.json',import.meta.url),metadata=JSON.parse(await fs.readFile(metadataURL,'utf8'));
  if(metadata.name!=='@ynx-chain/wallet-auth')throw Object.assign(Error('Original contract authority is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  const root=await fs.realpath(path.dirname(fileURLToPath(metadataURL))),sdk=createRequire(metadataURL);
  const load=async name=>{const entry=await fs.realpath(sdk.resolve('@ynx-chain/wallet-auth/'+name));if(!entry.startsWith(root+path.sep))throw Object.assign(Error('Original contract authority is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});return import(pathToFileURL(entry).href);};
  const guardAPI=await load('original-ide-contract-relay-guard'),connectionAPI=await load('walletconnect-dapp-connection');
  if(typeof guardAPI.acquireOriginalIDEContractRelayGuard!=='function'||typeof guardAPI.assertOriginalIDEContractRelayGuardCurrent!=='function'||typeof connectionAPI.createDeveloperContractConnection!=='function')throw Object.assign(Error('Original contract authority is unavailable.'),{code:'IDE_CONTRACT_NOT_SUPPLIED'});
  let guard,firstCause,failed=false,closed=false,cleanup;
  try{guard=await guardAPI.acquireOriginalIDEContractRelayGuard({serverModuleURL,...(expectedScope===undefined?{}:{expectedScope}),...(localContext===undefined?{}:{localContext})});}catch(error){failed=true;firstCause=error;guard=error?.cleanupOwner;}
  const current=()=>{if(closed)throw Object.assign(Error('Contract authority retired.'),{code:'IDE_CONTRACT_RETIRED'});if(failed)throw firstCause;return guardAPI.assertOriginalIDEContractRelayGuardCurrent(guard);};
  // A partial result stays cleanup-only, retaining its exact original cause.
  return Object.freeze({assertCurrent:current,createConnection(){const scope=current();return connectionAPI.createDeveloperContractConnection({relayGuard:guard,relayContext:{projectId:scope.projectId,projectGeneration:scope.projectGeneration}});},close(){closed=true;return cleanup ||= Promise.resolve().then(()=>guard?.close());}});
}
export async function createBundledProjectContractRuntime({context,serverModuleURL}){
  const {createProjectContractRuntime}=await import('./project-contract-runtime.mjs');
  return createProjectContractRuntime({context,loadMaterialBuilder:()=>loadBundledContractMaterialBuilder(),acquireAuthority:localContext=>openBundledContractRelayAuthority({serverModuleURL,localContext})});
}

// Separate from the old four session operations: identity receive/recovery can
// precede a qualified session parent. Only the original Auth/SDK fixed loader
// may obtain the Native table; no renderer path, object or expected statement
// is accepted here. Old SDKs and missing Native exports stay unavailable.
export async function openBundledWalletIdentityCaller(runningBackendModuleURL) {
  const original = await import('../../../packages/wallet-auth/src/original-ide-admission-parent-delivery.js');
  const acquire = original.acquireOriginalIDENativeAuthBinding;
  const unavailable = () => Object.assign(Error('Original Native identity operations are unavailable.'), {
    code: 'IDE_IDENTITY_NATIVE_UNAVAILABLE',
  });
  if (typeof acquire !== 'function') throw unavailable();
  const binding = await acquire(runningBackendModuleURL);
  if (binding === null || binding === undefined) throw unavailable();
  // Resolve the owner's public self-reference from its fixed bundled package,
  // only after its guarded getter actually supplies the Native table. SDK317
  // has neither capability; it must stay locally usable without an eager edge
  // to a future SDK's private files. No cwd/renderer/ambient package selection.
  const originalSDK = createRequire(new URL('../../../packages/wallet-auth/package.json', import.meta.url));
  const contract = await import(pathToFileURL(originalSDK.resolve('@ynx-chain/wallet-auth/auth-identity-contract')).href);
  const {OriginalIDEIdentityCall}=await import('./wallet-identity-v2-caller.mjs');
  // The caller must be retained by the backend before explicit begin(). Do not
  // construct/assert an owning partial here and then lose it on a late error.
  return new OriginalIDEIdentityCall({ binding, actualEntryURL: runningBackendModuleURL, contract });
}

// The original SDK kernel owns send/return/proof ordering. Creating this facade
// does not begin a request or allocate a peer; explicit begin remains required.
export async function openBundledWalletIdentityPeerCall(runningBackendModuleURL) {
  const caller=await openBundledWalletIdentityCaller(runningBackendModuleURL);
  return caller.openPeerCall();
}

export async function openBundledWalletAdmission(runningBackendModuleURL) {
  let delivery;
  try { delivery = await openOriginalParentDelivery({ supplier, runningBackendModuleURL,
    async validateInstalled(selection, actualEntry) {
      const { prepareOriginalIDEServiceAdmissionStartup } = await import('../../../packages/wallet-auth/src/original-ide-service-admission-startup.js');
      return prepareOriginalIDEServiceAdmissionStartup(selection, actualEntry, () => new Date());
    },
  }); } catch (error) {
    // A rejected connected-service input is not a prerequisite for local
    // coding. An acquired binding returns its retained cleanup-only facade
    // from delivery; a failure here occurred before any binding was supplied.
    return Object.freeze({ assertCurrent() { throw error; }, close() {},
      async finishCleanup() { return { complete: true }; } });
  }
  return delivery || await supplier.openOriginalIDEServiceAdmissionSupplier(runningBackendModuleURL);
}
