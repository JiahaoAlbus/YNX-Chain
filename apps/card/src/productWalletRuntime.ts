import {p256} from "@noble/curves/nist.js";
import * as WalletAuth from "@ynx-chain/wallet-auth-product-session-943";
import {getRandomValues} from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {Linking,Platform} from "react-native";
import {createCardProductWalletConnection,type CardProductWalletConnection} from "./productWalletConnection";

const {decodeBase64url,encodeBase64url}=WalletAuth as unknown as {decodeBase64url:(value:string)=>Uint8Array;encodeBase64url:(value:Uint8Array)=>string};
export const CARD_PRODUCT_SESSION_DEVICE_STORE_KEY="ynx-card-product-session-v2-device";
const CARD_PRODUCT_SESSION_STORAGE_PREFIX="ynx-card-product-session-v2-";
let nativeIdentityStorageUncertain=false;

export type {CardProductWalletConnection} from "./productWalletConnection";

export async function createRuntimeCardProductWalletConnection(input:Readonly<{canLaunch?:()=>boolean}>={}):Promise<CardProductWalletConnection>{
  const platform=runtimePlatform();
  if(!await SecureStore.isAvailableAsync())throw new Error("Secure device storage is unavailable; a Product Session was not created.");
  const fetcher=globalThis.fetch;
  if(typeof fetcher!=="function")throw new Error("Network transport is unavailable; a Product Session was not created.");
  const canLaunch=input.canLaunch??(()=>true);
  return createCardProductWalletConnection({platform,walletInstalled:async()=>await Linking.canOpenURL("ynxwallet://authorize").catch(()=>false),schemeRegistered:async()=>await Linking.canOpenURL("ynxwallet://authorize").catch(()=>false),storage:protectedStorage(platform),device:await protectedDevice(),openWallet:createNativeWalletOpener(canLaunch),fetch:async(url,init)=>await fetcher(url,init as RequestInit),tokenFactory:()=>encodeBase64url(randomBytes(32)),clock:()=>new Date()});
}

function runtimePlatform():"ios"|"android"{if(Platform.OS==="ios"||Platform.OS==="android")return Platform.OS;throw new Error("Product Session native identity is unavailable on web; use a Standard EIP-1193 Wallet instead.");}
function protectedStorage(platform:"ios"|"android"){return Object.freeze({securityLevel:"os-protected" as const,get:(key:string)=>SecureStore.getItemAsync(mappedStorageKey(platform,key)),set:async(key:string,value:string)=>{await SecureStore.setItemAsync(mappedStorageKey(platform,key),value);},remove:async(key:string)=>{await SecureStore.deleteItemAsync(mappedStorageKey(platform,key));}})}
function mappedStorageKey(platform:"ios"|"android",key:string):string{const base=`ynx.product-session.v2:card:${platform}:com.ynxweb4.card`,suffix=key.startsWith(base)?key.slice(base.length):null;if(suffix===null||!["",":pending",":return",":completion",":revoke"].includes(suffix))throw new Error("Product Session attempted to access an unrecognized Card secure-storage key.");return `${CARD_PRODUCT_SESSION_STORAGE_PREFIX}${platform}-${encodeBase64url(new TextEncoder().encode(key))}`;}
async function protectedDevice(){
  if(nativeIdentityStorageUncertain)throw new Error("Native identity storage is uncertain; restart after secure storage is repaired.");
  const key=CARD_PRODUCT_SESSION_DEVICE_STORE_KEY,stored=await SecureStore.getItemAsync(key),existing=parseDevice(stored);
  if(stored!==null&&!existing)throw new Error("Existing Card native identity storage is invalid; it was not replaced.");
  const raw=existing??Object.freeze({id:`card-v2-${encodeBase64url(randomBytes(16))}`,secret:encodeBase64url(randomBytes(32))});
  if(!existing){const serialized=JSON.stringify(raw);try{await SecureStore.setItemAsync(key,serialized);if(await SecureStore.getItemAsync(key)!==serialized)throw new Error("Secure device storage did not preserve the Card identity key.");}catch(error){nativeIdentityStorageUncertain=true;throw error;}}
  const secret=decodeBase64url(raw.secret),publicKey=encodeBase64url(p256.getPublicKey(secret,true));
  return Object.freeze({id:raw.id,key:publicKey,sign:async(input:{payload:string})=>encodeBase64url(p256.sign(decodeBase64url(input.payload),secret,{format:"der"}))});
}
function createNativeWalletOpener(canLaunch:()=>boolean){return async(input:Readonly<{url:string}>):Promise<Readonly<{opened:true}|{opened:false;code:string}>>=>{
  if(!canLaunch())return Object.freeze({opened:false,code:"USER_REJECTED"} as const);
  if(!isCanonicalNativeAuthorizeURL(input.url))return Object.freeze({opened:false,code:"SCHEME_NOT_REGISTERED"} as const);
  if(!await Linking.canOpenURL(input.url).catch(()=>false))return Object.freeze({opened:false,code:"WALLET_NOT_INSTALLED"} as const);
  if(!canLaunch())return Object.freeze({opened:false,code:"USER_REJECTED"} as const);
  try{await Linking.openURL(input.url);return Object.freeze({opened:true} as const)}catch{return Object.freeze({opened:false,code:"SCHEME_NOT_REGISTERED"} as const)}
};}
function isCanonicalNativeAuthorizeURL(value:string):boolean{try{const url=new URL(value),request=url.searchParams.get("request");return url.protocol==="ynxwallet:"&&url.hostname==="authorize"&&url.pathname===""&&url.username===""&&url.password===""&&url.hash===""&&[...url.searchParams.keys()].length===1&&typeof request==="string"&&request.length>32}catch{return false}}
function parseDevice(value:string|null):Readonly<{id:string;secret:string}>|null{try{const parsed=JSON.parse(value??"");return typeof parsed.id==="string"&&/^card-v2-[A-Za-z0-9_-]{16,64}$/.test(parsed.id)&&typeof parsed.secret==="string"&&decodeBase64url(parsed.secret).length===32?Object.freeze({id:parsed.id,secret:parsed.secret}):null;}catch{return null}}
function randomBytes(size:number):Uint8Array{if(!Number.isInteger(size)||size<1||size>1024)throw new Error("Native random-byte size is invalid.");try{return getRandomValues(new Uint8Array(size));}catch{throw new Error("Native cryptographic randomness is unavailable; a Card identity request was not created.");}}
