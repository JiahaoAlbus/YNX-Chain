export type OriginalWalletServiceOperation = 'beginYNX'|'handleReturn'|'restore'|'disconnect';
export interface OriginalWalletServiceResponse {
 readonly status:number;
 readonly headers:Readonly<Record<string,string>>;
 /** Exact original canonical Gateway HTTP body, not a reconstructed result. */
 readonly body:string;
}
export declare function hasOriginalWalletServicePrivateBridge():boolean;
/** Source-owned transport only; it cannot qualify Native custody or ACK it. */
export declare class OriginalWalletServicePrivateClient {
 constructor(config:Readonly<{timeoutMs:number}>);
 request(operation:OriginalWalletServiceOperation,phase:'time'|'effect',requestId:string,body:string|null,proofHeader:string|null,signal?:AbortSignal):Promise<OriginalWalletServiceResponse>;
 selectOutcome(operation:OriginalWalletServiceOperation,phase:'time'|'effect',requestId:string):Readonly<{response:OriginalWalletServiceResponse|null;unknown:boolean}>;
 status():Readonly<{unknown:boolean;retained:number}>;
}
