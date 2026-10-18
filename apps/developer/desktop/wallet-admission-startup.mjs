// Consume the owner's precise lazy entry, never its protected-startup barrel.
// The retained fixed null selection does not configure or grant admission.
// Only Resources/server.mjs supplies its own location; the supplier compares
// configured targets with independently approved original owner material.
import * as supplier from '../../../packages/wallet-auth/scripts/ynx-ide-service-admission-supplier.mjs';
import { openOriginalParentDelivery } from './wallet-admission-delivery.mjs';
import { OriginalIDEIdentityCall } from './wallet-identity-v2-caller.mjs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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
