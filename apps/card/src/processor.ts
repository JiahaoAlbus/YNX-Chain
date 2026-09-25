export const YNXT_TESTNET_ASSET="YNXT_TESTNET" as const;
export const TESTNET_SIMULATION_ENVIRONMENT="YNX_TESTNET_CARD_PAYMENT_SIMULATION" as const;

export type CardState="active"|"frozen"|"closed";
export type AuthorizationState="approved"|"declined"|"captured"|"reversed"|"expired";
export type ProcessorBalance=Readonly<{availableMinor:number;pendingMinor:number;postedMinor:number;asset:typeof YNXT_TESTNET_ASSET}>;
export type ProcessorControls=Readonly<{maxSingleTransactionMinor:number;dailyLimitMinor:number;monthlyLimitMinor:number;onlineEnabled:boolean;recurringEnabled:boolean;internationalEnabled:boolean;allowedMcc:readonly string[];blockedMcc:readonly string[];allowedMerchants:readonly string[];blockedMerchants:readonly string[];allowedCountries:readonly string[];blockedCountries:readonly string[];maxAuthorizationsPerFiveMinutes:number}>;
export type ProcessorCard=Readonly<{cardAccountId:string;walletAccount:string;cardId:string;state:CardState;createdAt:string;availableBalance:number;pendingBalance:number;postedBalance:number;asset:typeof YNXT_TESTNET_ASSET;controls:ProcessorControls;riskProfile:"testnet-default";currentProcessor:"testnet-simulation";environment:typeof TESTNET_SIMULATION_ENVIRONMENT;auditState:"append-only"}>;
export type MerchantRequest=Readonly<{merchantId:string;merchantName:string;merchantCategoryCode:string;country:string;amountMinor:number;currency:typeof YNXT_TESTNET_ASSET;channel:"online"|"terminal";cardNotPresent:boolean;recurring:boolean;timestamp:string;idempotencyKey:string}>;
export type ProcessorEvent=Readonly<{id:string;kind:"funding"|"authorization"|"capture"|"reversal"|"refund"|"freeze"|"unfreeze"|"close"|"recovery";cardId:string;amountMinor:number;currency:typeof YNXT_TESTNET_ASSET;status:"accepted"|"declined"|"recovered";reasonCode:string;safeMessage:string;idempotencyKey:string;relatedId?:string;occurredAt:string}>;
/** Synthetic simulation input, not an authenticated or durable chain proof. */
export type FundingProof=Readonly<{txHash:string;chainId:"0x1917";amountMinor:number;confirmations:number;idempotencyKey:string}>;
export type CaptureRequest=Readonly<{authorizationId:string;amountMinor:number;idempotencyKey:string;timestamp:string}>;
export type ReversalRequest=Readonly<{authorizationId:string;amountMinor:number;idempotencyKey:string;timestamp:string}>;
export type RefundRequest=Readonly<{captureId:string;amountMinor:number;idempotencyKey:string;timestamp:string}>;

export interface CardProcessor{
  createCard(input:Readonly<{cardAccountId:string;walletAccount:string;cardId:string;controls?:Partial<ProcessorControls>;createdAt:string}>):ProcessorCard;
  getCard(cardId:string):ProcessorCard;
  freezeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard;
  unfreezeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard;
  closeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard;
  authorize(cardId:string,input:MerchantRequest):ProcessorEvent;
  capture(cardId:string,input:CaptureRequest):ProcessorEvent;
  reverse(cardId:string,input:ReversalRequest):ProcessorEvent;
  refund(cardId:string,input:RefundRequest):ProcessorEvent;
  getTransaction(cardId:string,eventId:string):ProcessorEvent;
  getBalance(cardId:string):ProcessorBalance;
  getStatement(cardId:string):readonly ProcessorEvent[];
  getControls(cardId:string):ProcessorControls;
  updateControls(cardId:string,controls:Partial<ProcessorControls>,idempotencyKey:string,now:string):ProcessorCard;
}

type Authorization=Readonly<{event:ProcessorEvent;remainingMinor:number;expiresAt:number}>;
type Capture=Readonly<{event:ProcessorEvent;remainingMinor:number}>;
type Result=ProcessorEvent|ProcessorCard;
type IdempotencyRecord=Readonly<{fingerprint:string;result:Result}>;
type Account={card:ProcessorCard;balance:ProcessorBalance;authorizations:Map<string,Authorization>;captures:Map<string,Capture>;events:ProcessorEvent[];idempotency:Map<string,IdempotencyRecord>;lastTimestamp:number};

const defaults:ProcessorControls=Object.freeze({maxSingleTransactionMinor:1_000_000,dailyLimitMinor:2_000_000,monthlyLimitMinor:10_000_000,onlineEnabled:true,recurringEnabled:true,internationalEnabled:false,allowedMcc:Object.freeze([]),blockedMcc:Object.freeze([]),allowedMerchants:Object.freeze([]),blockedMerchants:Object.freeze([]),allowedCountries:Object.freeze([]),blockedCountries:Object.freeze([]),maxAuthorizationsPerFiveMinutes:3});

/** Owner-scoped, in-memory simulation only. FundingProof is synthetic input;
 * neither its shape nor confirmations authenticate a chain receipt. */
export class TestnetSimulationProcessor implements CardProcessor{
  readonly publicFundingEnabled=false;
  readonly persistentBackendConnected=false;
  readonly signaturesEnabled=false;
  readonly broadcastEnabled=false;
  readonly ownerAccount:string;
  private readonly accounts=new Map<string,Account>();
  private readonly fundingClaims=new Map<string,Readonly<{cardId:string;amountMinor:number;event:ProcessorEvent}>>();

  constructor(ownerAccount:string){this.ownerAccount=walletOwner(ownerAccount);Object.freeze(this)}

  createCard(input:Readonly<{cardAccountId:string;walletAccount:string;cardId:string;controls?:Partial<ProcessorControls>;createdAt:string}>):ProcessorCard{
    if(walletOwner(input.walletAccount)!==this.ownerAccount)throw new Error("Card owner does not match this processor");
    if(!identifier(input.cardAccountId)||!identifier(input.cardId)||this.accounts.has(input.cardId))throw new Error("Card account is invalid or already exists");
    const createdAt=timestamp(input.createdAt),controls=copyControls(defaults,input.controls??{});
    const card=Object.freeze({cardAccountId:input.cardAccountId,walletAccount:this.ownerAccount,cardId:input.cardId,state:"active" as const,createdAt:input.createdAt,availableBalance:0,pendingBalance:0,postedBalance:0,asset:YNXT_TESTNET_ASSET,controls,riskProfile:"testnet-default" as const,currentProcessor:"testnet-simulation" as const,environment:TESTNET_SIMULATION_ENVIRONMENT,auditState:"append-only" as const});
    this.accounts.set(card.cardId,{card,balance:freezeBalance(0,0,0),authorizations:new Map(),captures:new Map(),events:[],idempotency:new Map(),lastTimestamp:createdAt});
    return card;
  }

  getCard(cardId:string):ProcessorCard{return this.account(cardId).card}
  getBalance(cardId:string):ProcessorBalance{return this.account(cardId).balance}
  getStatement(cardId:string):readonly ProcessorEvent[]{return Object.freeze([...this.account(cardId).events])}
  getControls(cardId:string):ProcessorControls{return this.account(cardId).card.controls}
  getTransaction(cardId:string,eventId:string):ProcessorEvent{const event=this.account(cardId).events.find(item=>item.id===eventId);if(!event)throw new Error("Card transaction was not found");return event}

  creditTestnetFunding(cardId:string,proof:FundingProof,now:string):ProcessorEvent{
    const account=this.account(cardId),payload={...proof,txHash:typeof proof.txHash==="string"?proof.txHash.toLowerCase():proof.txHash,now};
    const known=this.duplicate<ProcessorEvent>(account,proof.idempotencyKey,"funding",payload);if(known)return known;
    if(proof.chainId!=="0x1917"||!/^0x[0-9a-f]{64}$/.test(payload.txHash)||!Number.isSafeInteger(proof.confirmations)||proof.confirmations<1)throw new Error("Synthetic YNX Testnet funding reference is invalid");
    assertAmount(proof.amountMinor);timestamp(now);
    const claimKey=JSON.stringify([this.ownerAccount,proof.chainId,payload.txHash]),claim=this.fundingClaims.get(claimKey);
    if(claim){
      if(claim.cardId!==cardId||claim.amountMinor!==proof.amountMinor)throw new Error("Funding transaction already credited with a conflicting card or amount");
      return this.remember(account,proof.idempotencyKey,"funding",payload,claim.event);
    }
    if(account.card.state==="closed")throw new Error("Card is closed");
    // Check total capacity before advancing time or changing any account state.
    freezeBalance(account.balance.availableMinor+proof.amountMinor,account.balance.pendingMinor,account.balance.postedMinor);
    this.advance(account,now);
    account.balance=freezeBalance(account.balance.availableMinor+proof.amountMinor,account.balance.pendingMinor,account.balance.postedMinor);this.replaceCardBalances(account);
    const event=this.append(account,"funding",proof.amountMinor,"accepted","TESTNET_FUNDING_CONFIRMED","Synthetic Testnet funding recorded in local simulation",proof.idempotencyKey,now,payload.txHash);
    this.fundingClaims.set(claimKey,Object.freeze({cardId,amountMinor:proof.amountMinor,event}));
    return this.remember(account,proof.idempotencyKey,"funding",payload,event);
  }

  freezeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard{return this.transitionCard(cardId,"frozen",idempotencyKey,now,"freeze")}
  unfreezeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard{return this.transitionCard(cardId,"active",idempotencyKey,now,"unfreeze")}
  closeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard{return this.transitionCard(cardId,"closed",idempotencyKey,now,"close")}

  updateControls(cardId:string,controls:Partial<ProcessorControls>,idempotencyKey:string,now:string):ProcessorCard{
    const account=this.account(cardId),payload={controls,now};
    const known=this.duplicate<ProcessorCard>(account,idempotencyKey,"controls",payload);if(known)return known;
    if(account.card.state==="closed")throw new Error("Card is closed");
    const next=copyControls(account.card.controls,controls);this.advance(account,now);
    account.card=Object.freeze({...account.card,controls:next});
    this.append(account,"recovery",0,"accepted","CONTROLS_UPDATED","Testnet controls updated",idempotencyKey,now);
    return this.remember(account,idempotencyKey,"controls",payload,account.card);
  }

  authorize(cardId:string,input:MerchantRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate<ProcessorEvent>(account,input.idempotencyKey,"authorization",input);if(known)return known;
    assertAmount(input.amountMinor);
    if(!identifier(input.merchantId)||typeof input.merchantName!=="string"||!input.merchantName.trim()||input.merchantName.length>160||typeof input.merchantCategoryCode!=="string"||!/^\d{4}$/.test(input.merchantCategoryCode)||typeof input.country!=="string"||!/^[A-Z]{2}$/.test(input.country)||!["online","terminal"].includes(input.channel)||typeof input.cardNotPresent!=="boolean"||typeof input.recurring!=="boolean")throw new Error("Merchant request is invalid");
    this.advance(account,input.timestamp);
    const reason=this.authorizationRisk(account,input);
    if(reason)return this.remember(account,input.idempotencyKey,"authorization",input,this.append(account,"authorization",input.amountMinor,"declined",reason,declineMessage(reason),input.idempotencyKey,input.timestamp));
    account.balance=freezeBalance(account.balance.availableMinor-input.amountMinor,account.balance.pendingMinor+input.amountMinor,account.balance.postedMinor);this.replaceCardBalances(account);
    const event=this.append(account,"authorization",input.amountMinor,"accepted","APPROVED","Simulated merchant authorization approved",input.idempotencyKey,input.timestamp);
    account.authorizations.set(event.id,Object.freeze({event,remainingMinor:input.amountMinor,expiresAt:timestamp(input.timestamp)+15*60_000}));
    return this.remember(account,input.idempotencyKey,"authorization",input,event);
  }

  capture(cardId:string,input:CaptureRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate<ProcessorEvent>(account,input.idempotencyKey,"capture",input);if(known)return known;
    assertAmount(input.amountMinor);assertReference(input.authorizationId);this.advance(account,input.timestamp);
    const authorization=account.authorizations.get(input.authorizationId);
    if(!authorization||authorization.remainingMinor<input.amountMinor)return this.remember(account,input.idempotencyKey,"capture",input,this.append(account,"capture",input.amountMinor,"declined","INVALID_CAPTURE","Capture is not available for this simulated authorization",input.idempotencyKey,input.timestamp,input.authorizationId));
    account.balance=freezeBalance(account.balance.availableMinor,account.balance.pendingMinor-input.amountMinor,account.balance.postedMinor+input.amountMinor);this.replaceCardBalances(account);
    const event=this.append(account,"capture",input.amountMinor,"accepted","CAPTURED","Simulated merchant capture posted",input.idempotencyKey,input.timestamp,input.authorizationId);
    account.authorizations.set(input.authorizationId,Object.freeze({...authorization,remainingMinor:authorization.remainingMinor-input.amountMinor}));account.captures.set(event.id,Object.freeze({event,remainingMinor:input.amountMinor}));
    return this.remember(account,input.idempotencyKey,"capture",input,event);
  }

  reverse(cardId:string,input:ReversalRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate<ProcessorEvent>(account,input.idempotencyKey,"reversal",input);if(known)return known;
    assertAmount(input.amountMinor);assertReference(input.authorizationId);this.advance(account,input.timestamp);
    const authorization=account.authorizations.get(input.authorizationId);
    if(!authorization||authorization.remainingMinor<input.amountMinor)return this.remember(account,input.idempotencyKey,"reversal",input,this.append(account,"reversal",input.amountMinor,"declined","INVALID_REVERSAL","Reversal is not available for this simulated authorization",input.idempotencyKey,input.timestamp,input.authorizationId));
    account.balance=freezeBalance(account.balance.availableMinor+input.amountMinor,account.balance.pendingMinor-input.amountMinor,account.balance.postedMinor);this.replaceCardBalances(account);
    account.authorizations.set(input.authorizationId,Object.freeze({...authorization,remainingMinor:authorization.remainingMinor-input.amountMinor}));
    return this.remember(account,input.idempotencyKey,"reversal",input,this.append(account,"reversal",input.amountMinor,"accepted","REVERSED","Simulated authorization released",input.idempotencyKey,input.timestamp,input.authorizationId));
  }

  refund(cardId:string,input:RefundRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate<ProcessorEvent>(account,input.idempotencyKey,"refund",input);if(known)return known;
    assertAmount(input.amountMinor);assertReference(input.captureId);this.advance(account,input.timestamp);
    const capture=account.captures.get(input.captureId);
    if(!capture||capture.remainingMinor<input.amountMinor)return this.remember(account,input.idempotencyKey,"refund",input,this.append(account,"refund",input.amountMinor,"declined","INVALID_REFUND","Refund is not available for this simulated capture",input.idempotencyKey,input.timestamp,input.captureId));
    account.balance=freezeBalance(account.balance.availableMinor+input.amountMinor,account.balance.pendingMinor,account.balance.postedMinor-input.amountMinor);this.replaceCardBalances(account);
    account.captures.set(input.captureId,Object.freeze({...capture,remainingMinor:capture.remainingMinor-input.amountMinor}));
    return this.remember(account,input.idempotencyKey,"refund",input,this.append(account,"refund",input.amountMinor,"accepted","REFUNDED","Simulated merchant refund posted",input.idempotencyKey,input.timestamp,input.captureId));
  }

  recover(cardId:string,now:string):readonly ProcessorEvent[]{return this.advance(this.account(cardId),now)}

  private advance(account:Account,now:string):readonly ProcessorEvent[]{
    const time=timestamp(now);if(time<account.lastTimestamp)throw new Error("Simulation time must not move backwards");
    account.lastTimestamp=time;const recovered:ProcessorEvent[]=[];
    for(const[id,authorization]of account.authorizations){
      if(authorization.remainingMinor>0&&authorization.expiresAt<=time){
        account.balance=freezeBalance(account.balance.availableMinor+authorization.remainingMinor,account.balance.pendingMinor-authorization.remainingMinor,account.balance.postedMinor);this.replaceCardBalances(account);
        account.authorizations.set(id,Object.freeze({...authorization,remainingMinor:0}));
        recovered.push(this.append(account,"recovery",authorization.remainingMinor,"recovered","AUTHORIZATION_EXPIRED","Expired simulated authorization released",`@expiration:${id}`,now,id));
      }
    }
    return Object.freeze(recovered);
  }

  private transitionCard(cardId:string,state:CardState,idempotencyKey:string,now:string,kind:"freeze"|"unfreeze"|"close"):ProcessorCard{
    const account=this.account(cardId),payload={state,now},known=this.duplicate<ProcessorCard>(account,idempotencyKey,kind,payload);if(known)return known;
    if(account.card.state==="closed")throw new Error("Card is closed");
    this.advance(account,now);if(state==="closed"&&account.balance.pendingMinor>0)throw new Error("Pending authorizations must be settled or released before close");
    account.card=Object.freeze({...account.card,state});this.append(account,kind,0,"accepted",kind.toUpperCase(),`Card ${state} in Testnet simulation`,idempotencyKey,now);
    return this.remember(account,idempotencyKey,kind,payload,account.card);
  }

  private authorizationRisk(account:Account,input:MerchantRequest):string|undefined{
    const controls=account.card.controls;
    if(account.card.state==="frozen")return "CARD_FROZEN";if(account.card.state==="closed")return "CARD_CLOSED";
    if(input.currency!==YNXT_TESTNET_ASSET)return "INVALID_AMOUNT";if(input.amountMinor>account.balance.availableMinor)return "INSUFFICIENT_BALANCE";
    if(input.amountMinor>controls.maxSingleTransactionMinor)return "MAX_TRANSACTION_EXCEEDED";
    if((input.channel==="online"||input.cardNotPresent)&&!controls.onlineEnabled)return "ONLINE_DISABLED";
    if(input.recurring&&!controls.recurringEnabled)return "RECURRING_DISABLED";if(input.country!=="YN"&&!controls.internationalEnabled)return "INTERNATIONAL_DISABLED";
    for(const[value,allowed,blocked,code]of [[input.merchantCategoryCode,controls.allowedMcc,controls.blockedMcc,"MCC"],[input.merchantId,controls.allowedMerchants,controls.blockedMerchants,"MERCHANT"],[input.country,controls.allowedCountries,controls.blockedCountries,"COUNTRY"]] as const){
      if(blocked.includes(value))return code+"_BLOCKED";if(allowed.length&&!allowed.includes(value))return code+"_NOT_ALLOWED";
    }
    const occurred=timestamp(input.timestamp),events=account.events.filter(event=>event.kind==="authorization"&&event.status==="accepted");
    if(sum(events.filter(event=>event.occurredAt.slice(0,10)===input.timestamp.slice(0,10)))+BigInt(input.amountMinor)>BigInt(controls.dailyLimitMinor))return "DAILY_LIMIT_EXCEEDED";
    if(sum(events.filter(event=>event.occurredAt.slice(0,7)===input.timestamp.slice(0,7)))+BigInt(input.amountMinor)>BigInt(controls.monthlyLimitMinor))return "MONTHLY_LIMIT_EXCEEDED";
    if(events.filter(event=>occurred-timestamp(event.occurredAt)<=5*60_000).length>=controls.maxAuthorizationsPerFiveMinutes)return "VELOCITY_EXCEEDED";
    return undefined;
  }

  private append(account:Account,kind:ProcessorEvent["kind"],amountMinor:number,status:ProcessorEvent["status"],reasonCode:string,safeMessage:string,idempotencyKey:string,occurredAt:string,relatedId?:string):ProcessorEvent{
    const event=Object.freeze({id:`evt:${this.ownerAccount}:${account.card.cardId}:${account.events.length+1}`,kind,cardId:account.card.cardId,amountMinor,currency:YNXT_TESTNET_ASSET,status,reasonCode,safeMessage,idempotencyKey,relatedId,occurredAt});account.events.push(event);return event;
  }
  private duplicate<T extends Result>(account:Account,key:string,kind:string,payload:unknown):T|undefined{
    if(!identifier(key))throw new Error("Idempotency key is invalid");const request=fingerprint(kind,payload),known=account.idempotency.get(key);
    if(known&&known.fingerprint!==request)throw new Error("Idempotency payload conflict");return known?.result as T|undefined;
  }
  private remember<T extends Result>(account:Account,key:string,kind:string,payload:unknown,result:T):T{
    account.idempotency.set(key,Object.freeze({fingerprint:fingerprint(kind,payload),result}));return result;
  }
  private account(cardId:string):Account{const account=this.accounts.get(cardId);if(!account)throw new Error("Card account was not found");return account}
  private replaceCardBalances(account:Account){account.card=Object.freeze({...account.card,availableBalance:account.balance.availableMinor,pendingBalance:account.balance.pendingMinor,postedBalance:account.balance.postedMinor})}
}

function identifier(value:unknown):value is string{return typeof value==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value)}
function walletOwner(value:string):string{if(typeof value!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(value))throw new Error("Card owner wallet is invalid");return value.toLowerCase()}
function timestamp(value:string):number{const millis=Date.parse(value);if(typeof value!=="string"||!Number.isFinite(millis)||new Date(millis).toISOString()!==value||millis>8_640_000_000_000_000-15*60_000)throw new Error("Simulation time must be a canonical UTC timestamp");return millis}
function assertAmount(value:number):void{if(!Number.isSafeInteger(value)||value<=0)throw new Error("Amount must be a positive safe integer")}
function assertReference(value:string):void{if(typeof value!=="string"||!value.trim()||value.length>400)throw new Error("Transaction reference is invalid")}
function freezeBalance(availableMinor:number,pendingMinor:number,postedMinor:number):ProcessorBalance{
  const amounts=[availableMinor,pendingMinor,postedMinor];if(amounts.some(v=>!Number.isSafeInteger(v)||v<0)||amounts.reduce((s,v)=>s+BigInt(v),0n)>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("Ledger safe integer capacity invariant failed");
  return Object.freeze({availableMinor,pendingMinor,postedMinor,asset:YNXT_TESTNET_ASSET});
}
function sum(events:readonly ProcessorEvent[]):bigint{return events.reduce((total,event)=>total+BigInt(event.amountMinor),0n)}
function fingerprint(kind:string,payload:unknown):string{
  function canonical(value:unknown):unknown{
    if(value===null||typeof value==="string"||typeof value==="boolean")return value;
    if(typeof value==="number"){if(!Number.isFinite(value))throw new Error("Request contains a non-finite amount");return value}
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
    throw new Error("Request contains an unsupported value");
  }
  return JSON.stringify([kind,canonical(payload)]);
}
function copyControls(current:ProcessorControls,patch:Partial<ProcessorControls>):ProcessorControls{
  if(!patch||typeof patch!=="object"||Array.isArray(patch)||Object.keys(patch).some(key=>!Object.prototype.hasOwnProperty.call(defaults,key)))throw new Error("Card controls are invalid");
  const next={...current,...patch};
  for(const key of ["maxSingleTransactionMinor","dailyLimitMinor","monthlyLimitMinor","maxAuthorizationsPerFiveMinutes"] as const)if(!Number.isSafeInteger(next[key])||next[key]<1)throw new Error("Card controls are invalid");
  for(const key of ["onlineEnabled","recurringEnabled","internationalEnabled"] as const)if(typeof next[key]!=="boolean")throw new Error("Card controls are invalid");
  const list=(value:readonly string[],pattern:RegExp)=>{if(!Array.isArray(value)||value.length>256||value.some(v=>typeof v!=="string"||!pattern.test(v)))throw new Error("Card controls are invalid");return Object.freeze([...value])};
  return Object.freeze({...next,allowedMcc:list(next.allowedMcc,/^\d{4}$/),blockedMcc:list(next.blockedMcc,/^\d{4}$/),allowedMerchants:list(next.allowedMerchants,/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/),blockedMerchants:list(next.blockedMerchants,/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/),allowedCountries:list(next.allowedCountries,/^[A-Z]{2}$/),blockedCountries:list(next.blockedCountries,/^[A-Z]{2}$/)});
}
function declineMessage(code:string):string{return({CARD_FROZEN:"Card is frozen in Testnet simulation",CARD_CLOSED:"Card is closed in Testnet simulation",INSUFFICIENT_BALANCE:"Insufficient Testnet YNXT balance",MAX_TRANSACTION_EXCEEDED:"Testnet transaction limit exceeded",ONLINE_DISABLED:"Online simulation is disabled",RECURRING_DISABLED:"Recurring simulation is disabled",INTERNATIONAL_DISABLED:"International simulation is disabled",MCC_BLOCKED:"Merchant category is blocked",MCC_NOT_ALLOWED:"Merchant category is not allowed",MERCHANT_BLOCKED:"Simulated merchant is blocked",MERCHANT_NOT_ALLOWED:"Simulated merchant is not allowed",COUNTRY_BLOCKED:"Simulated merchant country is blocked",COUNTRY_NOT_ALLOWED:"Simulated merchant country is not allowed",DAILY_LIMIT_EXCEEDED:"Daily Testnet limit exceeded",MONTHLY_LIMIT_EXCEEDED:"Monthly Testnet limit exceeded",VELOCITY_EXCEEDED:"Too many simulated authorization attempts",INVALID_AMOUNT:"Invalid Testnet amount"}as Record<string,string>)[code]??"Testnet simulation declined"}
