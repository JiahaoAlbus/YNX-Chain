import { unlockEncryptedVault } from "./extension-vault.js";
function fail(code) { throw Object.assign(new Error(code), {code}); }
// Local account management only. Never return or retain an unlocked secret.
export class HostedAccountManager {
  #generation=0; #record=null;
  constructor(store,unlock=unlockEncryptedVault){this.store=store;this.unlockVault=unlock;}
  lock(){this.#generation++;this.#record=null;}
  isUnlocked(vault){return this.#record!==null&&this.#record===JSON.stringify(vault);}
  async unlock(vault,password){
    this.lock();const generation=this.#generation,record=JSON.stringify(vault);
    const assertCurrent=async()=>{if(generation!==this.#generation)fail("HOSTED_UNLOCK_CANCELLED");if(JSON.stringify(await this.store.read())!==record)fail("HOSTED_ACCOUNT_CHANGED");if(generation!==this.#generation)fail("HOSTED_UNLOCK_CANCELLED");};
    await assertCurrent();
    const unlocked=await this.unlockVault(vault,password);
    if(unlocked.account!==vault.account)fail("HOSTED_ACCOUNT_MISMATCH");
    await assertCurrent();this.#record=record;
  }
  async assertUnlocked(vault){if(!this.isUnlocked(vault))fail("HOSTED_ACCOUNT_LOCKED");if(JSON.stringify(await this.store.read())!==this.#record){this.lock();fail("HOSTED_ACCOUNT_CHANGED");}if(!this.isUnlocked(vault))fail("HOSTED_ACCOUNT_LOCKED");}
}
export function hostedEntryMode({origin,topLevel,fragment}){
  if(origin!=="https://wallet.ynxweb4.com"||!topLevel)fail("HOSTED_ORIGIN_INVALID");
  if(fragment===""||fragment==="#account")return "account";
  if(fragment.startsWith("#connect="))return "connect";
  fail("HOSTED_CONNECT_INVALID");
}
