/** Resource custody only. This type is not Source, session, permission or payment authority. */
export type OriginalShopCurrent=(()=>undefined)&{readonly signal:AbortSignal};
export type OriginalShopCustodyDATA=Readonly<{selected:boolean;unknown:boolean;physicalDone:boolean}>;
export interface OriginalShopPrivateClient {
 current():void;
 /** Bounded original JSON DATA only; independent Native/current gates still apply. */
 readOriginalScopeDATA():unknown;
 /** Fixed original order GET. The original P06 caller alone validates invoice business fields. */
 readOriginalShopNativeInvoiceRequestDATA(orderID:string,current:OriginalShopCurrent):Promise<unknown>;
 readOriginalCustodyDATA():OriginalShopCustodyDATA;
 retire():void;
 join():Promise<void>;
 close():Promise<void>;
 /** True only after the captured Native physical witness, never from an exception property. */
 isClosed():boolean;
}
export type OriginalShopPrivateClientAcquisition=Readonly<{owner:OriginalShopPrivateClient|null;errorPresent:boolean;error?:unknown}>;
/** Zero arguments; fixed pre-load gate and actual Native exports only. */
export function acquireOriginalShopPrivateClient():OriginalShopPrivateClientAcquisition;
/** Native custody identity only, not currentness or authorization. */
export function isOriginalShopPrivateClient(value:unknown):value is OriginalShopPrivateClient;
