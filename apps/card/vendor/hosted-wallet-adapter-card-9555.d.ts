/** Web-only first-party adapter; no installation of window.ethereum and no Native root export. */
export type HostedWalletSelection=Readonly<{account:string;chainId:"0x1917";expiresAt:number}>;
export type HostedWalletAdapter=Readonly<{
  connect():Promise<readonly string[]>;
  reserve():Promise<readonly string[]>;
  request(input:Readonly<{method:string;params?:readonly unknown[]}>):Promise<unknown>;
  restore():Promise<readonly string[]>;
  disconnect():Promise<void>;
  suspend():void;
  revoke():Promise<Readonly<{revoked:true}>>;
  detach():Promise<void>;
  on(name:string,callback:(value:unknown)=>void):void;
  removeListener(name:string,callback:(value:unknown)=>void):boolean|undefined;
  supportsCardApplicationApproval:boolean;connected:boolean;account:string|null;selection:HostedWalletSelection|null;
}>;
/** Requires a real registered browser origin. Opens/approves only in the current user gesture; reserve sends no signing data. */
export declare function createHostedWalletAdapter(options?:Readonly<{window?:Window;walletOrigin?:"https://wallet.ynxweb4.com"}>):HostedWalletAdapter;

/** Accepted Hosted-only finite Card review; Native/Pair support is not implied. */
export declare const HOSTED_CARD_APPROVAL_METHOD:"ynx_requestCardApplicationApproval";
