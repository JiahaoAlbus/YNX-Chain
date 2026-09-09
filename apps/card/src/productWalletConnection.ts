import {ProductSessionGatewayFetchAdapter,RecoverableProductSessionClient,WalletConnectionCoordinator} from "@ynx-chain/wallet-auth-product-session-943";
import registry from "../vendor/product-session-registry-943a1693.json";

export const CARD_PRODUCT_SESSION_V2_ORIGIN="https://wallet-auth.ynxweb4.com";
export const CARD_PRODUCT_SESSION_V2_ROUTES=Object.freeze(["/v2/product-sessions/time","/v2/product-sessions/challenge","/v2/product-sessions/complete","/v2/product-sessions/introspect","/v2/product-sessions/revoke"] as const);
export const CARD_NATIVE_IDENTITY_SCOPES=Object.freeze(["account:read"] as const);
export type CardProductWalletConnection=WalletConnectionCoordinator;

type Device=Readonly<{id:string;key:string;sign:(input:Readonly<{purpose:"challenge"|"http-proof";algorithm:"p256-sha256";deviceKey:string;payload:string}>)=>Promise<string>}>
type ProtectedStorage=Readonly<{securityLevel:"os-protected";get:(key:string)=>Promise<string|null>;set:(key:string,value:string)=>Promise<void>;remove:(key:string)=>Promise<void>}>;
type GatewayFetch=(url:string,init:Readonly<Record<string,unknown>>)=>Promise<unknown>;
export type CardProductWalletCapabilities=Readonly<{platform:"ios"|"android";walletInstalled:()=>Promise<boolean>;schemeRegistered:()=>Promise<boolean>;storage:ProtectedStorage;device:Device;openWallet:(input:Readonly<{url:string;request:Readonly<Record<string,unknown>>;requestId:string;automatic:boolean;productId:string;platform:string}>)=>Promise<Readonly<{opened:true}|{opened:false;code:string}>>;fetch:GatewayFetch;tokenFactory:()=>string;clock:()=>Date}>;

export function createCardProductWalletConnection(capabilities:CardProductWalletCapabilities):CardProductWalletConnection{
  const gateway=new ProductSessionGatewayFetchAdapter({endpoint:CARD_PRODUCT_SESSION_V2_ORIGIN,fetch:capabilities.fetch,walletInstalled:capabilities.walletInstalled,schemeRegistered:capabilities.schemeRegistered,timeoutMs:10_000});
  const sessionClient=new RecoverableProductSessionClient({registry,productId:"card",platform:capabilities.platform,storage:capabilities.storage,gateway,device:{...capabilities.device,scopes:CARD_NATIVE_IDENTITY_SCOPES,purpose:"Read the YNX Wallet identity for YNX Card Testnet simulation. This does not create a card, funding authority, or payment authority."},tokenFactory:capabilities.tokenFactory,clock:capabilities.clock});
  return new WalletConnectionCoordinator({registry,productId:"card",sessionClient,scope:globalThis,discoveryWaitMs:0,openWallet:capabilities.openWallet,openTimeoutMs:10_000});
}
