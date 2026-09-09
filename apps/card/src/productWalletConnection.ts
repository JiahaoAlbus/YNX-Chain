import {ProductSessionGatewayFetchAdapter,RecoverableProductSessionClient,WalletConnectionCoordinator} from "@ynx-chain/wallet-auth-product-session-943";
import registry from "../vendor/product-session-registry-943a1693.json";
import {isNativeStorageOwnerExpiredError} from "./productWalletStorage";

export const CARD_PRODUCT_SESSION_V2_ORIGIN="https://wallet-auth.ynxweb4.com";
export const CARD_PRODUCT_SESSION_V2_ROUTES=Object.freeze(["/v2/product-sessions/time","/v2/product-sessions/challenge","/v2/product-sessions/complete","/v2/product-sessions/introspect","/v2/product-sessions/revoke"] as const);
export const CARD_NATIVE_IDENTITY_SCOPES=Object.freeze(["account:read"] as const);
type ProductSessionResult=Promise<Readonly<Record<string,unknown>>>;
export type CardProductWalletConnection=Readonly<{readonly current:Readonly<Record<string,unknown>>;readonly storageKey:string;readonly connectionBinding:Readonly<{productId:string;platform:string;applicationId:string}>;options:()=>ProductSessionResult;beginYNX:()=>ProductSessionResult;retryYNX:()=>ProductSessionResult;handleReturn:(url:string)=>ProductSessionResult;disconnect:()=>ProductSessionResult;setNetworkAvailable:(available:boolean)=>Readonly<Record<string,unknown>>;enterGuest:()=>Readonly<Record<string,unknown>>;}>;

type Device=Readonly<{id:string;key:string;sign:(input:Readonly<{purpose:"challenge"|"http-proof";algorithm:"p256-sha256";deviceKey:string;payload:string}>)=>Promise<string>}>
type ProtectedStorage=Readonly<{securityLevel:"os-protected";get:(key:string)=>Promise<string|null>;set:(key:string,value:string)=>Promise<void>;remove:(key:string)=>Promise<void>}>;
type GatewayFetch=(url:string,init:Readonly<Record<string,unknown>>)=>Promise<unknown>;
export type CardProductWalletCapabilities=Readonly<{platform:"ios"|"android";walletInstalled:()=>Promise<boolean>;schemeRegistered:()=>Promise<boolean>;storage:ProtectedStorage;device:Device;openWallet:(input:Readonly<{url:string;request:Readonly<Record<string,unknown>>;requestId:string;automatic:boolean;productId:string;platform:string}>)=>Promise<Readonly<{opened:true}|{opened:false;code:string}>>;fetch:GatewayFetch;tokenFactory:()=>string;clock:()=>Date}>;

export function createCardProductWalletConnection(capabilities:CardProductWalletCapabilities):CardProductWalletConnection{
  const gateway=new ProductSessionGatewayFetchAdapter({endpoint:CARD_PRODUCT_SESSION_V2_ORIGIN,fetch:capabilities.fetch,walletInstalled:capabilities.walletInstalled,schemeRegistered:capabilities.schemeRegistered,timeoutMs:10_000});
  const sessionClient=new RecoverableProductSessionClient({registry,productId:"card",platform:capabilities.platform,storage:capabilities.storage,gateway,device:{...capabilities.device,scopes:CARD_NATIVE_IDENTITY_SCOPES,purpose:"Read the YNX Wallet identity for YNX Card Testnet simulation. This does not create a card, funding authority, or payment authority."},tokenFactory:capabilities.tokenFactory,clock:capabilities.clock});
  return serializedCoordinator(new WalletConnectionCoordinator({registry,productId:"card",sessionClient,scope:globalThis,discoveryWaitMs:0,openWallet:capabilities.openWallet,openTimeoutMs:10_000}));
}
function serializedCoordinator(coordinator:WalletConnectionCoordinator):CardProductWalletConnection{
  let tail:Promise<void>=Promise.resolve();
  let activeBegin:ProductSessionResult|null=null;
  const serial=(operation:()=>Promise<Readonly<Record<string,unknown>>>)=>{const run=tail.then(operation,operation);tail=run.then(()=>undefined,()=>undefined);return run;};
  const cancelled=():Readonly<Record<string,unknown>>=>Object.freeze({status:"wallet-open-failed",code:"USER_REJECTED",sessionState:(coordinator.current as Readonly<Record<string,unknown>>).sessionState});
  const cancellable=async(operation:()=>Promise<Readonly<Record<string,unknown>>>)=>{try{return await operation();}catch(error){if(isNativeStorageOwnerExpiredError(error))return cancelled();throw error;}};
  const beginYNX=()=>{if(activeBegin)return activeBegin;const run=serial(async()=>await cancellable(()=>coordinator.beginYNX()));activeBegin=run;void run.then(()=>{if(activeBegin===run)activeBegin=null;},()=>{if(activeBegin===run)activeBegin=null;});return run;};
  return Object.freeze({get current(){return coordinator.current},get storageKey(){return coordinator.storageKey},get connectionBinding(){return coordinator.connectionBinding},options:async()=>await coordinator.options(),beginYNX,retryYNX:async()=>await serial(async()=>await cancellable(()=>coordinator.retryYNX())),handleReturn:async(url)=>await serial(async()=>await cancellable(()=>coordinator.handleReturn(url))),disconnect:async()=>await serial(async()=>await cancellable(()=>coordinator.disconnect())),setNetworkAvailable:available=>coordinator.setNetworkAvailable(available),enterGuest:()=>coordinator.enterGuest()});
}
