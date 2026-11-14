// Consume the owner's precise lazy entry, never its protected-startup barrel.
// The retained fixed null selection does not configure or grant admission.
// Only Resources/server.mjs supplies its own location; the supplier compares
// configured targets with independently approved original owner material.
import { loadBundledIdentitySDK } from './identity-sdk-loader.mjs';
import { openOriginalParentDelivery } from './wallet-admission-delivery.mjs';
export async function openBundledWalletAdmission(runningBackendModuleURL) {
  let delivery, supplier;
  try { supplier = await loadBundledIdentitySDK('scripts/ynx-ide-service-admission-supplier.mjs');
    delivery = await openOriginalParentDelivery({ supplier, runningBackendModuleURL,
    async validateInstalled(selection, actualEntry) {
      const { prepareOriginalIDEServiceAdmissionStartup } = await loadBundledIdentitySDK('src/original-ide-service-admission-startup.js');
      return prepareOriginalIDEServiceAdmissionStartup(selection, actualEntry, () => new Date());
    },
  });
    // Await inside the same boundary: supplier refusal disables connected
    // services, but must not prevent the ordinary local workbench from opening.
    return delivery || await supplier.openOriginalIDEServiceAdmissionSupplier(runningBackendModuleURL);
  } catch (error) {
    // A rejected connected-service input is not a prerequisite for local
    // coding. An acquired binding returns its retained cleanup-only facade
    // from delivery; a failure here occurred before any binding was supplied.
    return Object.freeze({ assertCurrent() { throw error; }, close() {},
      async finishCleanup() { return { complete: true }; } });
  }
}
