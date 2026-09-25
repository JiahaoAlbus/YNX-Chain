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
  if(!Number.isInteger(amountMinor)||amountMinor<=0)throw new Error("simulation amount must be a positive minor unit");
  if(!/^[A-Z]{3,4}$/.test(currency))throw new Error("currency must be an ISO currency code");
  if(!merchant.trim())throw new Error("merchant is required");
  if(!/^(?:[a-zA-Z0-9._-]{6,})$/.test(idempotencyKey))throw new Error("idempotency key format is invalid");
}

export function replayAwareAppend(entries:readonly SimulationAuditRecord[],input:SimulationInput,reason:string,now=new Date()):{entry:SimulationAuditRecord;next:readonly SimulationAuditRecord[];duplicate:boolean}{
  isValid(input.amountMinor,input.currency,input.merchant,input.idempotencyKey);
  const existing=entries.find(item=>item.idempotencyKey===input.idempotencyKey&&item.kind===input.kind&&item.cardId===input.cardId);
  if(existing){
    const duplicate={...existing,status:existing.status==="failed"?"recovered":"duplicate",reason:existing.status==="failed"?"Recovered from prior failure":"Replay detected" ,updatedAt:now.toISOString()} as SimulationAuditRecord;
    return {entry:duplicate,next:replaceEntry(entries,duplicate),duplicate:true};
  }
  const record:SimulationAuditRecord={id:simulationEntryId(input.kind,now),kind:input.kind,cardId:input.cardId,merchant:input.merchant.trim(),amountMinor:input.amountMinor,currency:input.currency,idempotencyKey:input.idempotencyKey,status:"accepted",reason,txHash:input.txHash,chainId:input.chainId,createdAt:now.toISOString(),updatedAt:now.toISOString()};
  const next=[record,...entries];
  return {entry:record,next:Object.freeze(next.slice(0,TESTNET_SIMULATION_MAX_EVENTS)),duplicate:false};
}

function replaceEntry(entries:readonly SimulationAuditRecord[],entry:SimulationAuditRecord):readonly SimulationAuditRecord[]{
  return Object.freeze(entries.map(item=>item.id===entry.id?entry:item));
}

export function recoverLastFailed(entries:readonly SimulationAuditRecord[]):readonly SimulationAuditRecord[]{
  const now=new Date().toISOString();
  const next=entries.map(item=>item.status==="failed"?{...item,status:"recovered",reason:"Recovery executed",updatedAt:now} as SimulationAuditRecord:item);
  return Object.freeze(next);
}

export function isFailure(entry:SimulationAuditRecord):boolean{return entry.status==="failed";}
