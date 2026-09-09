import {p256} from "@noble/curves/nist.js";
import * as WalletAuth from "@ynx-chain/wallet-auth-product-session-943";
import * as SecureStore from "expo-secure-store";
import {Linking,Platform} from "react-native";
import {createCardProductWalletConnection,type CardProductWalletConnection} from "./productWalletConnection";

const {decodeBase64url,encodeBase64url}=WalletAuth as unknown as {decodeBase64url:(value:string)=>Uint8Array;encodeBase64url:(value:Uint8Array)=>string};

export type {CardProductWalletConnection} from "./productWalletConnection";

export async function createRuntimeCardProductWalletConnection():Promise<CardProductWalletConnection>{
  const platform=runtimePlatform();
  if(!await SecureStore.isAvailableAsync())throw new Error("Secure device storage is unavailable; a Product Session was not created.");
  const fetcher=globalThis.fetch;
  if(typeof fetcher!=="function")throw new Error("Network transport is unavailable; a Product Session was not created.");
  return createCardProductWalletConnection({platform,walletInstalled:async()=>await Linking.canOpenURL("ynxwallet://authorize").catch(()=>false),schemeRegistered:async()=>await Linking.canOpenURL("ynxwallet://authorize").catch(()=>false),storage:protectedStorage(),device:await protectedDevice(),openWallet:nativeWalletOpener,fetch:async(url,init)=>await fetcher(url,init as RequestInit),tokenFactory:()=>encodeBase64url(randomBytes(32)),clock:()=>new Date()});
}

function runtimePlatform():"ios"|"android"{if(Platform.OS==="ios"||Platform.OS==="android")return Platform.OS;throw new Error("Product Session native identity is unavailable on web; use a Standard EIP-1193 Wallet instead.");}
function protectedStorage(){return Object.freeze({securityLevel:"os-protected" as const,get:(key:string)=>SecureStore.getItemAsync(key),set:async(key:string,value:string)=>{await SecureStore.setItemAsync(key,value);},remove:async(key:string)=>{await SecureStore.deleteItemAsync(key);}})}
async function protectedDevice(){
  const key="ynx-card:product-session-v2:device",stored=await SecureStore.getItemAsync(key),existing=parseDevice(stored);
  const raw=existing??Object.freeze({id:`card-v2-${encodeBase64url(randomBytes(16))}`,secret:encodeBase64url(randomBytes(32))});
  if(!existing)await SecureStore.setItemAsync(key,JSON.stringify(raw));
  const secret=decodeBase64url(raw.secret),publicKey=encodeBase64url(p256.getPublicKey(secret,true));
  return Object.freeze({id:raw.id,key:publicKey,sign:async(input:{payload:string})=>encodeBase64url(p256.sign(decodeBase64url(input.payload),secret,{format:"der"}))});
}
async function nativeWalletOpener(input:Readonly<{url:string}>):Promise<Readonly<{opened:true}|{opened:false;code:string}>>{
  if(!isCanonicalNativeAuthorizeURL(input.url))return Object.freeze({opened:false,code:"SCHEME_NOT_REGISTERED"} as const);
  if(!await Linking.canOpenURL(input.url).catch(()=>false))return Object.freeze({opened:false,code:"WALLET_NOT_INSTALLED"} as const);
  try{await Linking.openURL(input.url);return Object.freeze({opened:true} as const)}catch{return Object.freeze({opened:false,code:"WALLET_NOT_INSTALLED"} as const)}
}
function isCanonicalNativeAuthorizeURL(value:string):boolean{try{const url=new URL(value),request=url.searchParams.get("request");return url.protocol==="ynxwallet:"&&url.hostname==="authorize"&&url.pathname===""&&url.username===""&&url.password===""&&url.hash===""&&[...url.searchParams.keys()].length===1&&typeof request==="string"&&request.length>32}catch{return false}}
function parseDevice(value:string|null):Readonly<{id:string;secret:string}>|null{try{const parsed=JSON.parse(value??"");return typeof parsed.id==="string"&&/^card-v2-[A-Za-z0-9_-]{16,64}$/.test(parsed.id)&&typeof parsed.secret==="string"&&decodeBase64url(parsed.secret).length===32?Object.freeze({id:parsed.id,secret:parsed.secret}):null;}catch{return null}}
function randomBytes(size:number):Uint8Array{const crypto=globalThis.crypto;if(!crypto||typeof crypto.getRandomValues!=="function")throw new Error("Secure Product Session random source is unavailable");return crypto.getRandomValues(new Uint8Array(size));}
