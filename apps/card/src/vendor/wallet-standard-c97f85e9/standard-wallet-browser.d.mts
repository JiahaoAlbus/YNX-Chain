// Type-only subset of Wallet/Auth c97f85e9 src/index.d.ts. Runtime is the exact supplied bundle.
export type StandardWalletRevocationResult = Readonly<{status:"revoked"|"unsupported"|"rejected"|"failed"|"superseded";permissionRevoked:boolean;locallyDisconnected:boolean;error?:Readonly<{code:number;message:string}>}>;
export declare class StandardWalletConnection {
  constructor(config:Readonly<{provider:unknown;origin:string;metadata:Readonly<{name:string;url:string}>}>);
  readonly current:Readonly<Record<string,unknown>>|null;
  connect():Promise<Readonly<Record<string,unknown>>>;
  restore():Promise<Readonly<Record<string,unknown>>|null>;
  revoke():Promise<StandardWalletRevocationResult>;
  request(input:Readonly<{method:string;params?:unknown}>):Promise<unknown>;
  disconnect():void;
  subscribe(listener:(event:Readonly<{event:string;value:unknown}>)=>void):()=>boolean;
}
export type WalletProviderCandidate=Readonly<{kind:"ynx-wallet"|"metamask";provider:Readonly<{request:(input:Readonly<Record<string,unknown>>)=>Promise<unknown>}>;source:"eip6963"|"legacy-injected";uuid:string|null;rdns:string|null;name:string|null;authority:"unverified-injected-candidate"}>;
export type WalletProviderDiscovery=Readonly<{ynx:WalletProviderCandidate|null;metamask:WalletProviderCandidate|null;candidates:readonly WalletProviderCandidate[];ambiguities:readonly ("ynx-wallet"|"metamask")[];conflictedAnnouncements:number;authority:"unverified-injected-candidate"}>;
export declare function discoverInjectedWalletProviders(scope?:unknown):WalletProviderDiscovery;
export declare function discoverWalletProviders(scope?:unknown,waitMs?:number):Promise<WalletProviderDiscovery>;
