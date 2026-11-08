// PRIVATE fixed-image interface. This declaration is not Source registration.
export type OriginalAcquisition<T> = {owner:T|null;errorPresent:boolean;error?:unknown};
export type OriginalCurrent = (()=>undefined)&{readonly signal:AbortSignal};
export type OriginalCustodyDATA=Readonly<{selected:boolean;unknown:boolean;physicalDone:boolean}>;
export interface OriginalShopResponse {
 readOriginalCustodyDATA():OriginalCustodyDATA;
 readOriginalTransportDATA():Readonly<{status:number;methodOriginal:Uint8Array;pathOriginal:Uint8Array;contentTypeOriginal:Uint8Array;bodyOriginal:Uint8Array}>;
 release():Promise<void>;
}
export interface OriginalShopPrivateClient {
 readOriginalCustodyDATA():OriginalCustodyDATA;
 current():void;
 readOriginalScopeDATA():Uint8Array;
 readOriginalShopInvoiceTransport(orderID:string,current:OriginalCurrent):Promise<OriginalAcquisition<OriginalShopResponse>>;
 retire():void;
 join():Promise<void>;
 close():Promise<void>;
}
export declare function acquireOriginalShopPrivateClient():OriginalAcquisition<OriginalShopPrivateClient>;
export declare function isOriginalShopPrivateClient(value:unknown):value is OriginalShopPrivateClient;
