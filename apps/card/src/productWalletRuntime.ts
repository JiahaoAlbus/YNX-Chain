import {p256} from "@noble/curves/nist.js";
import * as WalletAuth from "@ynx-chain/wallet-auth";
import * as SecureStore from "expo-secure-store";
import {Platform} from "react-native";
import {createCardProductWalletConnection,type CardProductWalletConnection} from "./productWalletConnection";

const {decodeBase64url,encodeBase64url}=WalletAuth as unknown as {decodeBase64url:(value:string)=>Uint8Array;encodeBase64url:(value:Uint8Array)=>string};

export type {CardProductWalletConnection} from "./productWalletConnection";

export async function createRuntimeCardProductWalletConnection():Promise<CardProductWalletConnection>{
  // Card intentionally has no direct custom-scheme launcher. The accepted
  // successor launcher source is not present in this owner checkout, so this
  // private Product Session path fails closed until a verified Universal Link
  // or WalletConnect handoff can be consumed. Standard EIP-1193 remains
  // independent in App.tsx.
  return createCardProductWalletConnection({platform:runtimePlatform(),walletInstalled:async()=>false,schemeRegistered:async()=>false,storage:protectedStorage(),device:await protectedDevice(),openWallet:async()=>Object.freeze({opened:false,code:"SAFE_LAUNCHER_UNAVAILABLE"} as const)});
}

function runtimePlatform():"web"|"ios"|"android"{return Platform.OS==="ios"||Platform.OS==="android"?Platform.OS:"web"}
function protectedStorage(){return Object.freeze({securityLevel:"os-protected" as const,get:(key:string)=>SecureStore.getItemAsync(key),set:async(key:string,value:string)=>{await SecureStore.setItemAsync(key,value);},remove:async(key:string)=>{await SecureStore.deleteItemAsync(key);}})}
async function protectedDevice(){
  const key="ynx-card:product-session-v2:device",stored=await SecureStore.getItemAsync(key),existing=parseDevice(stored);
  const raw=existing??Object.freeze({id:`card-v2-${encodeBase64url(randomBytes(16))}`,secret:encodeBase64url(randomBytes(32))});
  if(!existing)await SecureStore.setItemAsync(key,JSON.stringify(raw));
  const secret=decodeBase64url(raw.secret),publicKey=encodeBase64url(p256.getPublicKey(secret,true));
  return Object.freeze({id:raw.id,key:publicKey,scopes:["account:read","card:application:write","card:controls:write","card:dispute:write"],purpose:"Connect YNX Card Testnet simulation through the canonical Wallet Product Session factory.",sign:async(input:{payload:string})=>encodeBase64url(p256.sign(decodeBase64url(input.payload),secret,{format:"der"}))});
}
function parseDevice(value:string|null):Readonly<{id:string;secret:string}>|null{try{const parsed=JSON.parse(value??"");return typeof parsed.id==="string"&&/^card-v2-[A-Za-z0-9_-]{16,64}$/.test(parsed.id)&&typeof parsed.secret==="string"&&decodeBase64url(parsed.secret).length===32?Object.freeze({id:parsed.id,secret:parsed.secret}):null;}catch{return null}}
function randomBytes(size:number):Uint8Array{const crypto=globalThis.crypto;if(!crypto||typeof crypto.getRandomValues!=="function")throw new Error("Secure Product Session random source is unavailable");return crypto.getRandomValues(new Uint8Array(size));}
