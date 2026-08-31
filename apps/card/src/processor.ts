export const YNXT_TESTNET_ASSET="YNXT_TESTNET" as const;
export const TESTNET_SIMULATION_ENVIRONMENT="YNX_TESTNET_CARD_PAYMENT_SIMULATION" as const;

export type CardState="active"|"frozen"|"closed";
export type AuthorizationState="approved"|"declined"|"captured"|"reversed"|"expired";
export type ProcessorBalance=Readonly<{availableMinor:number;pendingMinor:number;postedMinor:number;asset:typeof YNXT_TESTNET_ASSET}>;
export type ProcessorControls=Readonly<{maxSingleTransactionMinor:number;dailyLimitMinor:number;monthlyLimitMinor:number;onlineEnabled:boolean;recurringEnabled:boolean;internationalEnabled:boolean;allowedMcc:readonly string[];blockedMcc:readonly string[];allowedMerchants:readonly string[];blockedMerchants:readonly string[];allowedCountries:readonly string[];blockedCountries:readonly string[];maxAuthorizationsPerFiveMinutes:number}>;
export type ProcessorCard=Readonly<{cardAccountId:string;walletAccount:string;cardId:string;state:CardState;createdAt:string;availableBalance:number;pendingBalance:number;postedBalance:number;asset:typeof YNXT_TESTNET_ASSET;controls:ProcessorControls;riskProfile:"testnet-default";currentProcessor:"testnet-simulation";environment:typeof TESTNET_SIMULATION_ENVIRONMENT;auditState:"append-only"}>;
export type MerchantRequest=Readonly<{merchantId:string;merchantName:string;merchantCategoryCode:string;country:string;amountMinor:number;currency:typeof YNXT_TESTNET_ASSET;channel:"online"|"terminal";cardNotPresent:boolean;recurring:boolean;timestamp:string;idempotencyKey:string}>;
export type ProcessorEvent=Readonly<{id:string;kind:"funding"|"authorization"|"capture"|"reversal"|"refund"|"freeze"|"unfreeze"|"close"|"recovery";cardId:string;amountMinor:number;currency:typeof YNXT_TESTNET_ASSET;status:"accepted"|"declined"|"recovered";reasonCode:string;safeMessage:string;idempotencyKey:string;relatedId?:string;occurredAt:string}>;
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

type Authorization=Readonly<{event:ProcessorEvent;remainingMinor:number;expiresAt:string}>;
type Capture=Readonly<{event:ProcessorEvent;remainingMinor:number}>;
type Account={card:ProcessorCard;balance:ProcessorBalance;authorizations:Map<string,Authorization>;captures:Map<string,Capture>;events:ProcessorEvent[];idempotency:Map<string,ProcessorEvent>};

const defaults:ProcessorControls=Object.freeze({maxSingleTransactionMinor:1_000_000,dailyLimitMinor:2_000_000,monthlyLimitMinor:10_000_000,onlineEnabled:true,recurringEnabled:true,internationalEnabled:false,allowedMcc:[],blockedMcc:[],allowedMerchants:[],blockedMerchants:[],allowedCountries:[],blockedCountries:[],maxAuthorizationsPerFiveMinutes:3});

export class TestnetSimulationProcessor implements CardProcessor{
  private readonly accounts=new Map<string,Account>();

  createCard(input:Readonly<{cardAccountId:string;walletAccount:string;cardId:string;controls?:Partial<ProcessorControls>;createdAt:string}>):ProcessorCard{
    if(!input.cardAccountId||!input.walletAccount||!input.cardId||this.accounts.has(input.cardId))throw new Error("Card account is invalid or already exists");
    const controls=Object.freeze({...defaults,...input.controls});
    const card=Object.freeze({cardAccountId:input.cardAccountId,walletAccount:input.walletAccount,cardId:input.cardId,state:"active" as const,createdAt:input.createdAt,availableBalance:0,pendingBalance:0,postedBalance:0,asset:YNXT_TESTNET_ASSET,controls,riskProfile:"testnet-default" as const,currentProcessor:"testnet-simulation" as const,environment:TESTNET_SIMULATION_ENVIRONMENT,auditState:"append-only" as const});
    this.accounts.set(card.cardId,{card,balance:freezeBalance(0,0,0),authorizations:new Map(),captures:new Map(),events:[],idempotency:new Map()});
    return card;
  }

  getCard(cardId:string):ProcessorCard{return this.account(cardId).card}
  getBalance(cardId:string):ProcessorBalance{return this.account(cardId).balance}
  getStatement(cardId:string):readonly ProcessorEvent[]{return Object.freeze([...this.account(cardId).events])}
  getControls(cardId:string):ProcessorControls{return this.account(cardId).card.controls}
  getTransaction(cardId:string,eventId:string):ProcessorEvent{const event=this.account(cardId).events.find(item=>item.id===eventId);if(!event)throw new Error("Card transaction was not found");return event}

  creditTestnetFunding(cardId:string,proof:FundingProof,now:string):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate(account,proof.idempotencyKey);if(known)return known;
    if(proof.chainId!=="0x1917"||!/^0x[0-9a-fA-F]{64}$/.test(proof.txHash)||!validAmount(proof.amountMinor)||!Number.isSafeInteger(proof.confirmations)||proof.confirmations<1)throw new Error("Verified YNX Testnet funding proof is required");
    account.balance=freezeBalance(account.balance.availableMinor+proof.amountMinor,account.balance.pendingMinor,account.balance.postedMinor);
    this.replaceCardBalances(account);
    return this.append(account,"funding",proof.amountMinor,"accepted","TESTNET_FUNDING_CONFIRMED","Testnet YNXT funding confirmed",proof.idempotencyKey,now,proof.txHash);
  }

  freezeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard{return this.transitionCard(cardId,"frozen",idempotencyKey,now,"freeze")}
  unfreezeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard{return this.transitionCard(cardId,"active",idempotencyKey,now,"unfreeze")}
  closeCard(cardId:string,idempotencyKey:string,now:string):ProcessorCard{return this.transitionCard(cardId,"closed",idempotencyKey,now,"close")}

  updateControls(cardId:string,controls:Partial<ProcessorControls>,idempotencyKey:string,now:string):ProcessorCard{
    const account=this.account(cardId);if(this.duplicate(account,idempotencyKey))return account.card;
    const next=Object.freeze({...account.card.controls,...controls});this.assertControls(next);
    account.card=Object.freeze({...account.card,controls:next});
    this.append(account,"recovery",0,"accepted","CONTROLS_UPDATED","Testnet controls updated",idempotencyKey,now);
    return account.card;
  }

  authorize(cardId:string,input:MerchantRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate(account,input.idempotencyKey);if(known)return known;
    const reason=this.authorizationRisk(account,input);
    if(reason)return this.append(account,"authorization",input.amountMinor,"declined",reason,declineMessage(reason),input.idempotencyKey,input.timestamp);
    account.balance=freezeBalance(account.balance.availableMinor-input.amountMinor,account.balance.pendingMinor+input.amountMinor,account.balance.postedMinor);this.replaceCardBalances(account);
    const event=this.append(account,"authorization",input.amountMinor,"accepted","APPROVED","Simulated merchant authorization approved",input.idempotencyKey,input.timestamp);
    account.authorizations.set(event.id,Object.freeze({event,remainingMinor:input.amountMinor,expiresAt:new Date(Date.parse(input.timestamp)+15*60_000).toISOString()}));
    return event;
  }

  capture(cardId:string,input:CaptureRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate(account,input.idempotencyKey);if(known)return known;const authorization=account.authorizations.get(input.authorizationId);
    if(!authorization||authorization.remainingMinor<input.amountMinor||!validAmount(input.amountMinor))return this.append(account,"capture",Math.max(0,input.amountMinor),"declined","INVALID_CAPTURE","Capture is not available for this simulated authorization",input.idempotencyKey,input.timestamp,input.authorizationId);
    account.balance=freezeBalance(account.balance.availableMinor,account.balance.pendingMinor-input.amountMinor,account.balance.postedMinor+input.amountMinor);this.replaceCardBalances(account);
    const event=this.append(account,"capture",input.amountMinor,"accepted","CAPTURED","Simulated merchant capture posted",input.idempotencyKey,input.timestamp,input.authorizationId);
    account.authorizations.set(input.authorizationId,Object.freeze({...authorization,remainingMinor:authorization.remainingMinor-input.amountMinor}));account.captures.set(event.id,Object.freeze({event,remainingMinor:input.amountMinor}));return event;
  }

  reverse(cardId:string,input:ReversalRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate(account,input.idempotencyKey);if(known)return known;const authorization=account.authorizations.get(input.authorizationId);
    if(!authorization||authorization.remainingMinor<input.amountMinor||!validAmount(input.amountMinor))return this.append(account,"reversal",Math.max(0,input.amountMinor),"declined","INVALID_REVERSAL","Reversal is not available for this simulated authorization",input.idempotencyKey,input.timestamp,input.authorizationId);
    account.balance=freezeBalance(account.balance.availableMinor+input.amountMinor,account.balance.pendingMinor-input.amountMinor,account.balance.postedMinor);this.replaceCardBalances(account);
    account.authorizations.set(input.authorizationId,Object.freeze({...authorization,remainingMinor:authorization.remainingMinor-input.amountMinor}));return this.append(account,"reversal",input.amountMinor,"accepted","REVERSED","Simulated authorization released",input.idempotencyKey,input.timestamp,input.authorizationId);
  }

  refund(cardId:string,input:RefundRequest):ProcessorEvent{
    const account=this.account(cardId),known=this.duplicate(account,input.idempotencyKey);if(known)return known;const capture=account.captures.get(input.captureId);
    if(!capture||capture.remainingMinor<input.amountMinor||!validAmount(input.amountMinor))return this.append(account,"refund",Math.max(0,input.amountMinor),"declined","INVALID_REFUND","Refund is not available for this simulated capture",input.idempotencyKey,input.timestamp,input.captureId);
    account.balance=freezeBalance(account.balance.availableMinor+input.amountMinor,account.balance.pendingMinor,account.balance.postedMinor-input.amountMinor);this.replaceCardBalances(account);
    account.captures.set(input.captureId,Object.freeze({...capture,remainingMinor:capture.remainingMinor-input.amountMinor}));return this.append(account,"refund",input.amountMinor,"accepted","REFUNDED","Simulated merchant refund posted",input.idempotencyKey,input.timestamp,input.captureId);
  }

  recover(cardId:string,now:string):readonly ProcessorEvent[]{
    const account=this.account(cardId),recovered:ProcessorEvent[]=[];
    for(const[id,authorization]of account.authorizations){if(authorization.remainingMinor>0&&Date.parse(authorization.expiresAt)<=Date.parse(now)){account.balance=freezeBalance(account.balance.availableMinor+authorization.remainingMinor,account.balance.pendingMinor-authorization.remainingMinor,account.balance.postedMinor);this.replaceCardBalances(account);account.authorizations.set(id,Object.freeze({...authorization,remainingMinor:0}));recovered.push(this.append(account,"recovery",authorization.remainingMinor,"recovered","AUTHORIZATION_EXPIRED","Expired simulated authorization released",`recover-${id}`,now,id));}}
    return Object.freeze(recovered);
  }

  private transitionCard(cardId:string,state:CardState,idempotencyKey:string,now:string,kind:"freeze"|"unfreeze"|"close"):ProcessorCard{const account=this.account(cardId);if(this.duplicate(account,idempotencyKey))return account.card;account.card=Object.freeze({...account.card,state});this.append(account,kind,0,"accepted",kind.toUpperCase(),`Card ${state} in Testnet simulation`,idempotencyKey,now);return account.card}
  private authorizationRisk(account:Account,input:MerchantRequest):string|undefined{
    const controls=account.card.controls;if(account.card.state==="frozen")return "CARD_FROZEN";if(account.card.state==="closed")return "CARD_CLOSED";if(!validAmount(input.amountMinor)||input.currency!==YNXT_TESTNET_ASSET)return "INVALID_AMOUNT";if(input.amountMinor>account.balance.availableMinor)return "INSUFFICIENT_BALANCE";if(input.amountMinor>controls.maxSingleTransactionMinor)return "MAX_TRANSACTION_EXCEEDED";if(input.cardNotPresent&&!controls.onlineEnabled)return "ONLINE_DISABLED";if(input.recurring&&!controls.recurringEnabled)return "RECURRING_DISABLED";if(input.country!=="YN"&&!controls.internationalEnabled)return "INTERNATIONAL_DISABLED";if(controls.blockedMcc.includes(input.merchantCategoryCode))return "MCC_BLOCKED";if(controls.allowedMcc.length&&!controls.allowedMcc.includes(input.merchantCategoryCode))return "MCC_NOT_ALLOWED";if(controls.blockedMerchants.includes(input.merchantId))return "MERCHANT_BLOCKED";if(controls.allowedMerchants.length&&!controls.allowedMerchants.includes(input.merchantId))return "MERCHANT_NOT_ALLOWED";if(controls.blockedCountries.includes(input.country))return "COUNTRY_BLOCKED";if(controls.allowedCountries.length&&!controls.allowedCountries.includes(input.country))return "COUNTRY_NOT_ALLOWED";
    const occurred=Date.parse(input.timestamp),events=account.events.filter(event=>event.kind==="authorization"&&event.status==="accepted");if(sum(events.filter(event=>event.occurredAt.slice(0,10)===input.timestamp.slice(0,10)))+input.amountMinor>controls.dailyLimitMinor)return "DAILY_LIMIT_EXCEEDED";if(sum(events.filter(event=>event.occurredAt.slice(0,7)===input.timestamp.slice(0,7)))+input.amountMinor>controls.monthlyLimitMinor)return "MONTHLY_LIMIT_EXCEEDED";if(events.filter(event=>occurred-Date.parse(event.occurredAt)<=5*60_000&&occurred>=Date.parse(event.occurredAt)).length>=controls.maxAuthorizationsPerFiveMinutes)return "VELOCITY_EXCEEDED";
    return undefined;
  }
  private append(account:Account,kind:ProcessorEvent["kind"],amountMinor:number,status:ProcessorEvent["status"],reasonCode:string,safeMessage:string,idempotencyKey:string,occurredAt:string,relatedId?:string):ProcessorEvent{const event=Object.freeze({id:`evt-${account.card.cardId}-${account.events.length+1}`,kind,cardId:account.card.cardId,amountMinor,currency:YNXT_TESTNET_ASSET,status,reasonCode,safeMessage,idempotencyKey,relatedId,occurredAt});account.events.push(event);account.idempotency.set(idempotencyKey,event);return event}
  private duplicate(account:Account,idempotencyKey:string):ProcessorEvent|undefined{if(!idempotencyKey.trim())throw new Error("Idempotency key is required");return account.idempotency.get(idempotencyKey)}
  private account(cardId:string):Account{const account=this.accounts.get(cardId);if(!account)throw new Error("Card account was not found");return account}
  private replaceCardBalances(account:Account){account.card=Object.freeze({...account.card,availableBalance:account.balance.availableMinor,pendingBalance:account.balance.pendingMinor,postedBalance:account.balance.postedMinor})}
  private assertControls(value:ProcessorControls){if(!Number.isSafeInteger(value.maxSingleTransactionMinor)||value.maxSingleTransactionMinor<1||!Number.isSafeInteger(value.dailyLimitMinor)||value.dailyLimitMinor<1||!Number.isSafeInteger(value.monthlyLimitMinor)||value.monthlyLimitMinor<1||!Number.isSafeInteger(value.maxAuthorizationsPerFiveMinutes)||value.maxAuthorizationsPerFiveMinutes<1)throw new Error("Card controls are invalid")}
}

function validAmount(value:number):boolean{return Number.isSafeInteger(value)&&value>0}
function freezeBalance(availableMinor:number,pendingMinor:number,postedMinor:number):ProcessorBalance{if(availableMinor<0||pendingMinor<0||postedMinor<0)throw new Error("Ledger invariant failed");return Object.freeze({availableMinor,pendingMinor,postedMinor,asset:YNXT_TESTNET_ASSET})}
function sum(events:readonly ProcessorEvent[]):number{return events.reduce((total,event)=>total+event.amountMinor,0)}
function declineMessage(code:string):string{return({CARD_FROZEN:"Card is frozen in Testnet simulation",CARD_CLOSED:"Card is closed in Testnet simulation",INSUFFICIENT_BALANCE:"Insufficient Testnet YNXT balance",MAX_TRANSACTION_EXCEEDED:"Testnet transaction limit exceeded",ONLINE_DISABLED:"Online simulation is disabled",RECURRING_DISABLED:"Recurring simulation is disabled",INTERNATIONAL_DISABLED:"International simulation is disabled",MCC_BLOCKED:"Merchant category is blocked",MCC_NOT_ALLOWED:"Merchant category is not allowed",MERCHANT_BLOCKED:"Simulated merchant is blocked",MERCHANT_NOT_ALLOWED:"Simulated merchant is not allowed",COUNTRY_BLOCKED:"Simulated merchant country is blocked",COUNTRY_NOT_ALLOWED:"Simulated merchant country is not allowed",DAILY_LIMIT_EXCEEDED:"Daily Testnet limit exceeded",MONTHLY_LIMIT_EXCEEDED:"Monthly Testnet limit exceeded",VELOCITY_EXCEEDED:"Too many simulated authorization attempts",INVALID_AMOUNT:"Invalid Testnet amount"}as Record<string,string>)[code]??"Testnet simulation declined"}
