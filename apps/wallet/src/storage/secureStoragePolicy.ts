import type { SecureStorageAdapter } from "./walletRepository";
import { SecureStorageHealth } from "./secureStorageHealth";

export const AUTHENTICATED_SECRET_SERVICE = "com.ynxweb4.wallet.account-secrets.v3";
export const SECRET_AUTHENTICATION_PROMPT = "Confirm biometrics to protect or use this YNX Wallet account key";

type NativeOptions = {keychainAccessible?:number;keychainService?:string;requireAuthentication?:boolean;authenticationPrompt?:string};
export type NativeSecureStore = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number;
  getItemAsync(key:string,options?:NativeOptions):Promise<string|null>;
  setItemAsync(key:string,value:string,options?:NativeOptions):Promise<void>;
  deleteItemAsync(key:string,options?:NativeOptions):Promise<void>;
};

/** Public records remain readable while Wallet is locked. Private account records use
 * Android Keystore cipher-bound biometrics / iOS Keychain biometric-current-set access.
 * The iOS accessibility option is not an Android hardware-backing assertion. */
export function createPlatformSecureStorage(native:NativeSecureStore, health = new SecureStorageHealth()): SecureStorageAdapter {
  const invoke = async <T>(action:()=>Promise<T>, mutation=false):Promise<T> => {
    health.assertHealthy();
    try {
      const value = await action();
      health.assertHealthy();
      return value;
    } catch (caught) {
      health.observe(caught);
      if (mutation && !health.requiresRestart) {
        // The first failed native commit preserves its Write/DeleteException.
        // A read-only, unauthenticated probe distinguishes process quarantine
        // from recoverable errors such as a cancelled biometric prompt. Never
        // retry the mutation, read an account secret, or acknowledge its value.
        try { await native.getItemAsync("ynx.wallet.storage-health.probe.v1"); }
        catch (probeError) { health.observe(probeError); }
      }
      health.assertHealthy();
      throw caught;
    }
  };
  const secretOptions = Object.freeze({
    keychainService:AUTHENTICATED_SECRET_SERVICE,
    requireAuthentication:true,
    authenticationPrompt:SECRET_AUTHENTICATION_PROMPT,
    keychainAccessible:native.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const assertSecretKey = (key:string) => {
    if (!/^ynx\.wallet\.account\.auth\.v3\.ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(key)) throw new Error("Invalid authenticated Wallet account key");
  };
  return {
    getItem:(key)=>invoke(()=>native.getItemAsync(key)),
    setItem:(key,value)=>{
      // No new secret material may be copied into the unauthenticated metadata service.
      if (key.startsWith("ynx.wallet.account.") || key === "ynx.mobile.identity.v1") return Promise.reject(new Error("Account secrets require OS-authenticated storage"));
      return invoke(()=>native.setItemAsync(key,value,{keychainAccessible:native.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),true);
    },
    deleteItem:(key)=>invoke(()=>native.deleteItemAsync(key),true),
    authenticatedSecrets:{
      getItem:(key)=>{assertSecretKey(key);return invoke(()=>native.getItemAsync(key,secretOptions))},
      setItem:(key,value)=>{assertSecretKey(key);return invoke(()=>native.setItemAsync(key,value,secretOptions),true)},
      deleteItem:(key)=>{assertSecretKey(key);return invoke(()=>native.deleteItemAsync(key,secretOptions),true)},
    },
  };
}
