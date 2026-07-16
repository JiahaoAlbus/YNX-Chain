import * as SecureStore from "expo-secure-store";
import type { WalletSession } from "./api";
import type { AuthorizationRequest, SignedPaymentIntent, WalletPaymentResult } from "./walletAuth";

const PREFIX="ynx-pay.secure.v2.";
export type PendingAuthorization=Readonly<{request:AuthorizationRequest;deviceSecret:string}>;
export type PendingPayment=Readonly<{intent:SignedPaymentIntent;result?:WalletPaymentResult;updatedAt:string}>;

export async function loadSession():Promise<WalletSession|null>{return load<WalletSession>("session",value=>typeof value.token==="string"&&typeof value.sessionBinding==="string"&&Date.parse(value.expiresAt)>Date.now())}
export async function saveSession(value:WalletSession|null){return save("session",value)}
export async function loadPendingAuthorization():Promise<PendingAuthorization|null>{return load<PendingAuthorization>("authorization",value=>typeof value.deviceSecret==="string"&&value.request?.productClientId==="ynx-pay-v1"&&Date.parse(value.request.expiresAt)>Date.now())}
export async function savePendingAuthorization(value:PendingAuthorization|null){return save("authorization",value)}
export async function loadPendingPayment():Promise<PendingPayment|null>{return load<PendingPayment>("payment",value=>value.intent?.productClientId==="ynx-pay-v1"&&typeof value.updatedAt==="string")}
export async function savePendingPayment(value:PendingPayment|null){return save("payment",value)}
export async function loadLocale():Promise<string|null>{return SecureStore.getItemAsync(PREFIX+"locale")}
export async function saveLocale(value:string){return SecureStore.setItemAsync(PREFIX+"locale",value)}
export async function loadAILanguage():Promise<string|null>{return SecureStore.getItemAsync(PREFIX+"ai-language")}
export async function saveAILanguage(value:string){return SecureStore.setItemAsync(PREFIX+"ai-language",value)}

async function save(key:string,value:unknown|null){if(value===null)return SecureStore.deleteItemAsync(PREFIX+key);return SecureStore.setItemAsync(PREFIX+key,JSON.stringify(value),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})}
async function load<T extends Record<string,any>>(key:string,valid:(value:T)=>boolean):Promise<T|null>{const raw=await SecureStore.getItemAsync(PREFIX+key);if(!raw)return null;try{const value=JSON.parse(raw) as T;if(valid(value))return value}catch{}await SecureStore.deleteItemAsync(PREFIX+key);return null}
