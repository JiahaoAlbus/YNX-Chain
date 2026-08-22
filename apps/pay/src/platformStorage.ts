import {Platform} from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Pay persists product state only. Wallet credentials, private keys, callbacks,
 * and Product Sessions are never written here.
 *
 * Expo SecureStore has no browser implementation. Use origin-scoped Web
 * Storage for the web export and retain device-only SecureStore on native.
 */
export async function getProductState(key:string):Promise<string|null>{
  if(Platform.OS==='web')return webStorage()?.getItem(key)??null;
  return SecureStore.getItemAsync(key);
}

export async function setProductState(key:string,value:string):Promise<void>{
  if(Platform.OS==='web'){
    const storage=webStorage();
    if(!storage)throw new Error('PAY_WEB_STORAGE_UNAVAILABLE');
    storage.setItem(key,value);
    return;
  }
  await SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
}

export async function removeProductState(key:string):Promise<void>{
  if(Platform.OS==='web'){
    webStorage()?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function webStorage():Storage|null{
  try{return typeof globalThis.localStorage==='undefined'?null:globalThis.localStorage}catch{return null}
}
