import * as SecureStore from "expo-secure-store";
import type {Locale} from "./i18n/catalog";

const KEYS={token:"ynx.ai.session.token",deviceId:"ynx.ai.session.device",deviceSecret:"ynx.ai.device.p256",locale:"ynx.ai.locale",output:"ynx.ai.output",lastConversation:"ynx.ai.lastConversation",pendingRevocation:"ynx.ai.session.pendingRevocation"} as const;
export type RestoredState={token:string;deviceId:string;deviceSecret:string;locale:Locale|null;outputLanguage:Locale;lastConversation:string|null};
export async function restoreState():Promise<RestoredState>{
  const [token,deviceId,deviceSecret,locale,outputLanguage,lastConversation]=await Promise.all([KEYS.token,KEYS.deviceId,KEYS.deviceSecret,KEYS.locale,KEYS.output,KEYS.lastConversation].map(key=>SecureStore.getItemAsync(key)));
  return {token:token||"",deviceId:deviceId||"",deviceSecret:deviceSecret||"",locale:(locale as Locale)||null,outputLanguage:(outputLanguage as Locale)||"en",lastConversation:lastConversation||null};
}
export async function saveSession(token:string,deviceId:string){await Promise.all([SecureStore.setItemAsync(KEYS.token,token),SecureStore.setItemAsync(KEYS.deviceId,deviceId)]);}
export async function clearSession(){await Promise.all([SecureStore.deleteItemAsync(KEYS.token),SecureStore.deleteItemAsync(KEYS.deviceId),SecureStore.deleteItemAsync(KEYS.lastConversation)]);}
// Preserve the original local session locator for later SDK-owned recovery.
// This is not the Native protected target and never mints proof or retries.
let pendingWrite:Promise<void>=Promise.resolve();
export function retainPendingRevocation(token:string,deviceId:string){
 const write=pendingWrite.catch(()=>{}).then(async()=>{
  if(await SecureStore.getItemAsync(KEYS.pendingRevocation))throw Error('ORIGINAL_REVOCATION_ALREADY_PENDING');
  await SecureStore.setItemAsync(KEYS.pendingRevocation,JSON.stringify({token,deviceId}));
 });
 pendingWrite=write;return write;
}
export async function hasPendingRevocation(){return !!(await SecureStore.getItemAsync(KEYS.pendingRevocation));}
export const saveDeviceSecret=(value:string)=>SecureStore.setItemAsync(KEYS.deviceSecret,value);
export const saveLocale=(value:Locale|null)=>value?SecureStore.setItemAsync(KEYS.locale,value):SecureStore.deleteItemAsync(KEYS.locale);
export const saveOutputLanguage=(value:Locale)=>SecureStore.setItemAsync(KEYS.output,value);
export const saveLastConversation=(value:string)=>SecureStore.setItemAsync(KEYS.lastConversation,value);
