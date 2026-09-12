export type Provider={request(input:{method:string;params?:readonly unknown[]|Record<string,unknown>}):Promise<unknown>;on?:Function;removeListener?:Function};
export type Session=Readonly<{selectedAccount:string;selectedChain:string;connected:true}>;
export type Revocation=Readonly<{status:'revoked'|'unsupported'|'rejected'|'failed'|'superseded';permissionRevoked:boolean;locallyDisconnected:boolean;error?:{code:number;message:string}}>;
export class StandardWalletConnection {
 constructor(config:{provider:Provider;origin:string;metadata:{name:string;url:string}});
 readonly current:Session|null;
 connect():Promise<Session>;
 restore():Promise<Session|null>;
 request(input:{method:string;params?:readonly unknown[]|Record<string,unknown>}):Promise<unknown>;
 revoke():Promise<Revocation>;
 disconnect():void;
 subscribe(listener:(input:{event:string;value:unknown})=>void):()=>void;
}
export function discoverWalletProviders(scope?:unknown,waitMs?:number):Promise<{ynx:{kind:'ynx-wallet';provider:Provider}|null;metamask:{kind:'metamask';provider:Provider}|null;ambiguities:string[];authority:'unverified-injected-candidate'}>;
