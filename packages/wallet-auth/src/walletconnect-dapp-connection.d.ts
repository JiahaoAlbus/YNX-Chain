/** Immutable local observation only; settlement/absence/pause is not remote cleanup proof. */
export interface WalletConnectCleanupSnapshot {
 readonly scope:'local-only';
 readonly attempt:number;
 readonly stage:'idle'|'initialization'|'relay'|'approval';
 readonly connection:'not-started'|'pending'|'fulfilled'|'rejected';
 readonly initialization:'not-started'|'pending'|'fulfilled'|'rejected';
 readonly inFlight:boolean;
 readonly draining:boolean;
 readonly cancelled:boolean;
 readonly cleanup:'unobserved'|'unknown'|'transport-paused'|'shared-preserved';
 readonly firstCause:Readonly<{present:boolean;code:string|null}>;
 readonly remoteCleanup:'not-proven';
 readonly remoteCleanupUnconfirmed:true;
}
export declare const YNX_PAIR_PROJECT_ID: "41857128a14a593ca4e4a7cb7c838d71";
export declare const DEVELOPER_CONTRACT_METHODS:readonly ['ynx_preparePQContractAction','ynx_preparePQContractBroadcast','ynx_getPQContractOriginal'];
export type DeveloperContractMethod=typeof DEVELOPER_CONTRACT_METHODS[number];
export interface DeveloperContractRequestSnapshot {
 readonly scope:'local-only';
 readonly origin:'https://developer.ynxweb4.com';
 readonly method:DeveloperContractMethod;
 readonly requestPayloadSHA256:string;
 readonly account:string;
 readonly chainId:'eip155:6423';
 readonly state:'pending'|'fulfilled'|'unknown';
 readonly originalRequestKeyHash:string|null;
 readonly correlation:'missing'|'observed'|'conflict';
 readonly remoteOutcome:'not-proven';
 readonly replayAllowed:false;
}
export interface DeveloperContractRequestHandle {
 readonly outcome:Promise<unknown>;
 /** Late original sent events remain observable after a timeout. Persist the
  * observed hash in the owning consumer journal; never recreate or retry a write. */
 snapshot():DeveloperContractRequestSnapshot;
}
export interface DeveloperContractRequest {
 method:DeveloperContractMethod;
 params:[{version:1;account:string;[key:string]:unknown}];
}
export interface WalletConnectProvider {
 readonly isYNXWallet:true;
 readonly isMetaMask:false;
 readonly isYNXPair:true;
 readonly providerInfo:Readonly<{rdns:"com.ynx.wallet.pair"}>;
 on(event:string,listener:(value:unknown)=>void):void;
 removeListener(event:string,listener:(value:unknown)=>void):void;
 request(input:{method:"eth_accounts"|"eth_requestAccounts";params?:unknown[]}):Promise<string[]>;
 request(input:{method:"eth_chainId";params?:unknown[]}):Promise<"0x1917">;
 request(input:{method:string;params?:unknown[]}):Promise<unknown>;
}
/** Structural seam for integration tests; omitted in normal browser consumers. */
export interface WalletConnectSignClient {
 on(event:string,listener:(value:any)=>void):unknown;
 session:{getAll():any[]};
 core:{pairing:{disconnect(input:{topic:string}):Promise<unknown>}};
 connect(input:{requiredNamespaces:{eip155:{chains:string[];methods:string[];events:string[]}}}):Promise<{uri:string;approval():Promise<any>}>;
 disconnect(input:{topic:string;reason:{code:number;message:string}}):Promise<unknown>;
 request(input:{topic:string;chainId:string;request:{method:string;params:unknown[]};expiry:number}):Promise<unknown>;
}
export interface WalletAddressConnectionOptions {
 clientFactory?:(options:{projectId:string;metadata:{name:string;description:string;url:string;icons:string[]};logger:string;storageOptions:{database:string}})=>Promise<WalletConnectSignClient>;
 deadlineMs?:number;
 now?:()=>number;
}
/** Original transport; a connection is not an identity/ProductSession grant. */
export declare class WalletConnectDAppConnection {
 constructor(options:{origin:string;methods:string[]}&WalletAddressConnectionOptions);
 /** Does not initialize, restore, inspect remote stores, or perform cleanup.
  * Re-read this original instance for late promise settlement; UNKNOWN is sticky. */
 cleanupSnapshot():WalletConnectCleanupSnapshot;
 on(event:string,listener:(value:unknown)=>void):void;
 removeListener(event:string,listener:(value:unknown)=>void):void;
 initialize():Promise<WalletConnectSignClient>;
 restore():Promise<WalletConnectProvider|null>;
 connect(options?:{onURI?:(uri:string)=>void;restore?:boolean}):Promise<WalletConnectProvider>;
 /** Local cancellation fences late approval; unresolved original initialization rejects
  * YNX_PAIR_CLEANUP_UNCONFIRMED and emits cancelUnconfirmed independently. */
 cancel():Promise<void>;
 /** No confirmed disconnect is emitted while original initialization cleanup is unknown. */
 disconnect():Promise<void>;
 provider():WalletConnectProvider;
 request(input:{method:string;params?:unknown[]}):Promise<unknown>;
 /** Available only on the dedicated developer-contract factory instance. */
 beginContractRequest(input:DeveloperContractRequest):DeveloperContractRequestHandle;
}
/** Exact https://wallet.ynxweb4.com / eip155:6423 address-only profile.
 * Proposes methods:[], locally answers account/chain reads after approval,
 * and rejects all remote RPC, signing and identity requests. */
export declare function createWalletAddressConnection(options?:WalletAddressConnectionOptions):WalletConnectDAppConnection;
/** Exact developer origin/Testnet/three-method profile. This shares the original
 * SignClient store and lifecycle; it does not grant identity or signing rights.
 * No Relay is initialized by constructing it. */
export declare function createDeveloperContractConnection(options?:WalletAddressConnectionOptions):WalletConnectDAppConnection;
