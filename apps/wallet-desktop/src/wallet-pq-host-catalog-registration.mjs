// Original Protocol commissioning dependency, NOT a public network default.
// No actual independently accepted production registration pair has been
// delivered. Keep absent until that original owner supplies catalogPath and
// catalogSha256 through the protected source handoff. Never compute this from
// the catalog being checked, package assets, ENV, UI or a PUBLIC test fixture.
// Missing actual input does not remove the normal receiver/loader code.
export const originalPQHostCatalogRegistration=null;

import {PQHostCatalogStore} from './wallet-pq-host-catalog-store.mjs';
// Private Main receiver factory. `journalBinding` must be derived by original
// Main from its saved transaction, never supplied by a catalog/renderer. This
// receiver stores DATA only: the independently qualified original operator
// must hand over the pair. No public IPC, filesystem watcher or ENV installer
// is created here, and receipt retention never replaces Host acquire/current.
export function createOriginalPQHostCatalogReceiver({directory}){
 const store=new PQHostCatalogStore({directory});
 return Object.freeze({
  receive:(journalBinding,independentPair)=>store.retain(journalBinding,independentPair),
  select:journalBinding=>store.select(journalBinding),
  pending:()=>store.pending(),
  reconcile:()=>store.reconcile(),
  assertSafeToClose(){if(store.pending())throw Object.assign(Error('PQ_HOST_REGISTRATION_UNCONFIRMED'),{code:'PQ_HOST_REGISTRATION_UNCONFIRMED'});}
 });
}
