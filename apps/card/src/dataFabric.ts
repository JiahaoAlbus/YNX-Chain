import type {ProcessorEvent} from"./processor";

export type CardDataFabricEventName="card.created"|"card.funded"|"card.authorization.requested"|"card.authorization.approved"|"card.authorization.declined"|"card.capture.completed"|"card.authorization.reversed"|"card.refund.created"|"card.refund.completed"|"card.frozen"|"card.unfrozen"|"card.closed";
export type CardDataFabricEvent=Readonly<{id:string;name:CardDataFabricEventName;occurredAt:string;cardId:string;sourceEventId:string;idempotencyKey:string;status:"completed"|"declined";reasonCode?:string;amountMinor?:number;asset?:"YNXT_TESTNET";testnetSimulation:true;chainEvidence?:Readonly<{chainId:"0x1917";txHash:string}>}>;
export type DataFabricTransport=Readonly<{publish:(event:CardDataFabricEvent)=>Promise<void>}>;
export type OutboxRecord=Readonly<{event:CardDataFabricEvent;attempts:number;lastError?:string}>;

export function mapProcessorEvent(event:ProcessorEvent):readonly CardDataFabricEvent[]{
  const base={occurredAt:event.occurredAt,cardId:event.cardId,sourceEventId:event.id,idempotencyKey:event.idempotencyKey,testnetSimulation:true as const};
  const create=(suffix:string,name:CardDataFabricEventName,status:"completed"|"declined",extra:Partial<CardDataFabricEvent>={})=>Object.freeze({id:`${event.id}:${suffix}`,name,status,...base,...extra}) as CardDataFabricEvent;
  if(event.kind==="funding")return event.status==="accepted"&&event.reasonCode==="TESTNET_FUNDING_CONFIRMED"&&validTransactionHash(event.relatedId)?Object.freeze([create("funded","card.funded","completed",{amountMinor:event.amountMinor,asset:event.currency,chainEvidence:{chainId:"0x1917",txHash:event.relatedId}})]):Object.freeze([]);
  if(event.kind==="authorization")return event.status==="accepted"?Object.freeze([create("requested","card.authorization.requested","completed",{amountMinor:event.amountMinor,asset:event.currency}),create("approved","card.authorization.approved","completed",{amountMinor:event.amountMinor,asset:event.currency})]):Object.freeze([create("requested","card.authorization.requested","completed",{amountMinor:event.amountMinor,asset:event.currency}),create("declined","card.authorization.declined","declined",{amountMinor:event.amountMinor,asset:event.currency,reasonCode:event.reasonCode})]);
  if(event.kind==="capture"&&event.status==="accepted")return Object.freeze([create("capture","card.capture.completed","completed",{amountMinor:event.amountMinor,asset:event.currency})]);
  if(event.kind==="reversal"&&event.status==="accepted")return Object.freeze([create("reversal","card.authorization.reversed","completed",{amountMinor:event.amountMinor,asset:event.currency})]);
  if(event.kind==="refund"&&event.status==="accepted")return Object.freeze([create("refund-created","card.refund.created","completed",{amountMinor:event.amountMinor,asset:event.currency}),create("refund-completed","card.refund.completed","completed",{amountMinor:event.amountMinor,asset:event.currency})]);
  if(event.kind==="freeze"&&event.status==="accepted")return Object.freeze([create("frozen","card.frozen","completed")]);
  if(event.kind==="unfreeze"&&event.status==="accepted")return Object.freeze([create("unfrozen","card.unfrozen","completed")]);
  if(event.kind==="close"&&event.status==="accepted")return Object.freeze([create("closed","card.closed","completed")]);
  return Object.freeze([]);
}

export class CardDataFabricOutbox{
  private readonly records=new Map<string,OutboxRecord>();
  enqueue(events:readonly CardDataFabricEvent[]):readonly OutboxRecord[]{for(const event of events)if(!this.records.has(event.id))this.records.set(event.id,Object.freeze({event,attempts:0}));return this.pending()}
  pending():readonly OutboxRecord[]{return Object.freeze([...this.records.values()])}
  async flush(transport:DataFabricTransport):Promise<readonly OutboxRecord[]>{for(const[id,record]of this.records){try{await transport.publish(record.event);this.records.delete(id)}catch(error){this.records.set(id,Object.freeze({...record,attempts:record.attempts+1,lastError:error instanceof Error?error.message:"Data Fabric publish failed"}))}}return this.pending()}
}

function validTransactionHash(value:unknown):value is string{return typeof value==="string"&&/^0x[0-9a-fA-F]{64}$/.test(value)}
