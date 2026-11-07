/** Private same-process original operand. Not a Source/Native grant or wire type.
 * Only actual ledger.openOriginalTaskEffectContinuation returns the runtime cap;
 * JSON/recovery/readonly observations cannot restore its WeakMap recognition. */
declare const originalContinuation:unique symbol;
export interface OriginalTaskEffectContinuation{readonly [originalContinuation]:never;}
export interface OriginalTaskEffectTransportLoan{assertCurrent():void|Promise<void>;retire():void|Promise<void>;join():void|Promise<void>;close():void|Promise<void>;}
export interface OriginalTaskEffectReceiptDATA{readonly operationId:string;readonly state:'COMMITTED'|'FAILED';readonly original:string;}
export interface OriginalTaskEffectRequestDATA{readonly grant:unknown;readonly step:unknown;readonly operationId:string;readonly rawInput:Uint8Array;readonly holderProof:unknown;readonly expectedGrantRevision:string;}
export interface RegisteredOriginalTaskEffectExecutor{readonly target:unknown;executeOriginalTaskEffect(sameCaller:unknown,originalRequestDATA:OriginalTaskEffectRequestDATA,sameContinuation:OriginalTaskEffectContinuation):Promise<Readonly<{owner:OriginalTaskEffectTransportLoan|null;errorPresent:boolean;error?:unknown;result?:OriginalTaskEffectReceiptDATA}>>;}
export interface OriginalTaskEffectContinuationLedgerPort{
 openOriginalTaskEffectContinuation(sameFreshTicket:unknown,expected:Readonly<{grant:unknown;step:unknown;operationId:string;amount:string;inputBinding:unknown;at:number;assertCurrent():void}>):OriginalTaskEffectContinuation;
 currentOriginalTaskEffectContinuation(sameCap:OriginalTaskEffectContinuation,expected:Readonly<{grant:unknown;operationId:string;at:number}>):void;
 claimOriginalTaskEffectContinuation(sameCap:OriginalTaskEffectContinuation,expected:Readonly<{grant:unknown;operationId:string;at:number}>):void;
 retireOriginalTaskEffectContinuation(sameCap:OriginalTaskEffectContinuation):void;
 closeOriginalTaskEffectContinuation(sameCap:OriginalTaskEffectContinuation):void;
}
