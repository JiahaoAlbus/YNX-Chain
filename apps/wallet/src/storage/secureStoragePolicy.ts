import type { SecureStorageAdapter } from "./walletRepository";

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
export function createPlatformSecureStorage(native:NativeSecureStore): SecureStorageAdapter {
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
    getItem:(key)=>native.getItemAsync(key),
    setItem:(key,value)=>{
      // No new secret material may be copied into the unauthenticated metadata service.
      if (key.startsWith("ynx.wallet.account.") || key === "ynx.mobile.identity.v1") return Promise.reject(new Error("Account secrets require OS-authenticated storage"));
      return native.setItemAsync(key,value,{keychainAccessible:native.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
    },
    deleteItem:(key)=>native.deleteItemAsync(key),
    authenticatedSecrets:{
      getItem:(key)=>{assertSecretKey(key);return native.getItemAsync(key,secretOptions)},
      setItem:(key,value)=>{assertSecretKey(key);return native.setItemAsync(key,value,secretOptions)},
      deleteItem:(key)=>{assertSecretKey(key);return native.deleteItemAsync(key,secretOptions)},
    },
  };
}
