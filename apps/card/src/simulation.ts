export const TESTNET_SIMULATION_MAX_EVENTS=120;
export const TESTNET_SIMULATION_CURRENCY="YNXT";

export type SimulationOperation="topup"|"authorization"|"capture"|"reversal"|"refund";
export type SimulationStatus="accepted"|"failed"|"duplicate"|"recovered";

export type SimulationAuditRecord=Readonly<{
  id:string;
  kind:SimulationOperation;
  cardId:string;
  merchant:string;
  amountMinor:number;
  currency:string;
  idempotencyKey:string;
  status:SimulationStatus;
  reason:string;
  txHash?:string;
  chainId?:string;
  createdAt:string;
  updatedAt:string;
}>;

export type SimulationInput=Readonly<{
  kind:SimulationOperation;
  cardId:string;
  merchant:string;
  amountMinor:number;
  currency:string;
  idempotencyKey:string;
  txHash?:string;
  chainId?:string;
}>;

export function simulationEntryId(operation:SimulationOperation,now:Date = new Date()):string{return `sim-${operation}-${now.toISOString().replace(/[^0-9]/g,"")}`}

function isValid(amountMinor:number,currency:string,merchant:string,idempotencyKey:string):void{
  if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw new Error("simulation amount must be a positive safe minor unit");
  if(!/^[A-Z]{3,4}$/.test(currency))throw new Error("currency must be an ISO currency code");
  if(!merchant.trim())throw new Error("merchant is required");
  if(!/^(?:[a-zA-Z0-9._-]{6,})$/.test(idempotencyKey))throw new Error("idempotency key format is invalid");
}

export function replayAwareAppend(entries:readonly SimulationAuditRecord[],input:SimulationInput,reason:string,now=new Date()):{entry:SimulationAuditRecord;next:readonly SimulationAuditRecord[];duplicate:boolean}{
  isValid(input.amountMinor,input.currency,input.merchant,input.idempotencyKey);
  const existing=entries.find(item=>item.idempotencyKey===input.idempotencyKey&&item.kind===input.kind&&item.cardId===input.cardId);
  if(existing){
    if(existing.amountMinor!==input.amountMinor||existing.currency!==input.currency||existing.merchant!==input.merchant.trim()||existing.txHash!==input.txHash||existing.chainId!==input.chainId)throw new Error("SIMULATION_IDEMPOTENCY_CONFLICT");
    return {entry:existing,next:entries,duplicate:true};
  }
  const record:SimulationAuditRecord=Object.freeze({id:`${simulationEntryId(input.kind,now)}:${input.cardId}:${input.idempotencyKey}`,kind:input.kind,cardId:input.cardId,merchant:input.merchant.trim(),amountMinor:input.amountMinor,currency:input.currency,idempotencyKey:input.idempotencyKey,status:"accepted",reason,txHash:input.txHash,chainId:input.chainId,createdAt:now.toISOString(),updatedAt:now.toISOString()});
  const next=[record,...entries];
  return {entry:record,next:Object.freeze(next.slice(0,TESTNET_SIMULATION_MAX_EVENTS)),duplicate:false};
}

export function recoverLastFailed(entries:readonly SimulationAuditRecord[]):readonly SimulationAuditRecord[]{
  // A local recovery action cannot prove that a rejected/unknown operation
  // succeeded. Preserve its original outcome until authoritative readback.
  return Object.freeze([...entries]);
}

export function isFailure(entry:SimulationAuditRecord):boolean{return entry.status==="failed";}
