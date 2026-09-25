import type {ApplicationDetails,BusinessChallenge,CardScope,ChainReceipt,FundingIntent} from '../server/contracts';
import {walletErrorResponse} from '@ynx-chain/wallet-auth';

export const CARD_BUSINESS_ORIGIN='https://card.ynxweb4.com';
const ENVIRONMENT='YNX_TESTNET_CARD_PAYMENT_SIMULATION';
type ObjectValue=Record<string,unknown>;
export type CardPrivateIdentity=Readonly<{owner:string;sessionBinding:string;expiresAt:string}>;
export type CardApplicationView=Readonly<{id:string;owner:string;status:'DRAFT'|'SUBMITTED'|'APPROVAL_REQUIRED'|'ACTIVE'|'REJECTED'|'CANCELLED'|'DEGRADED';details:ApplicationDetails;createdAt:string;updatedAt:string;challenge?:BusinessChallenge;approvalId?:string;cardId?:string;reason?:string}>;
export type CardBalanceView=Readonly<{availableWei:string;pendingWei:string;postedWei:string;feeWei:string;fundedWei:string}>;
export type TestnetCardView=Readonly<{id:string;applicationId:string;owner:string;alias:string;status:'ACTIVE'|'FROZEN'|'CLOSED';balance:CardBalanceView;fundingSender?:string;controls:ObjectValue;createdAt:string}>;
export type CardFundingView=Readonly<FundingIntent&{receipt?:ChainReceipt}>;
export type CardBusinessSnapshot=Readonly<{environment:typeof ENVIRONMENT;productionRealPayments:false;asset:'YNXT_TESTNET';applications:readonly CardApplicationView[];cards:readonly TestnetCardView[];intents:readonly CardFundingView[]}>;
export class CardBusinessError extends Error {
  constructor(readonly code:string,readonly layer:'configuration'|'product-session'|'card-api'|'context',readonly retryable=false){super(code);this.name='CardBusinessError';}
}
type Capabilities=Readonly<{
  expectedSourceCommit:string;
  platform?:'web'|'ios'|'android';
  identity:()=>CardPrivateIdentity|null;
  // Supply the accepted SDK's createIntrospectionProof method. Card never signs or decodes DeviceProof.
  createIntrospectionProof:(requiredScopes:readonly string[])=>Promise<Readonly<{proofHeader:string}>>;
  fetch?:typeof fetch;
  timeoutMs?:number;
}>;
const record=(value:unknown):value is ObjectValue=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const owner=(value:unknown):value is string=>typeof value==='string'&&(/^(0x[0-9a-f]{40}|ynx1[023456789acdefghjklmnpqrstuvwxyz]{38})$/.test(value));
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{1,159}$/.test(value);
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const wei=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
const invalid=()=>new CardBusinessError('INVALID_CARD_API_RESPONSE','card-api');
function privateFailure(error:unknown):CardBusinessError {
  try{const {body}=walletErrorResponse(record(error)?error.code:error);return new CardBusinessError(body.code,'product-session',body.retryable);}
  catch{return new CardBusinessError('UNKNOWN_WALLET_ERROR','product-session');}
}
function rejectSensitive(value:unknown,depth=0):void {
  if(depth>40)throw invalid();
  if(Array.isArray(value)){for(const item of value)rejectSensitive(item,depth+1);return;}
  if(!record(value))return;
  for(const [key,item]of Object.entries(value)){
    if(/^(pan|cvv|cvc|pin|seed|mnemonic|privateKey|cryptogram|trackData|fullCardNumber|identityDocument)$/i.test(key))throw new CardBusinessError('SENSITIVE_CARD_DATA_REJECTED','card-api');
    rejectSensitive(item,depth+1);
  }
}
function application(value:unknown,account:string):CardApplicationView {
  if(!record(value)||!id(value.id)||value.owner!==account||!['DRAFT','SUBMITTED','APPROVAL_REQUIRED','ACTIVE','REJECTED','CANCELLED','DEGRADED'].includes(String(value.status))||!record(value.details)||!date(value.createdAt)||!date(value.updatedAt))throw invalid();
  const details=value.details;
  if(typeof details.nickname!=='string'||details.nickname.length>48||typeof details.useCase!=='string'||details.useCase.length>160||!wei(details.limitWei)||BigInt(details.limitWei)<=0n||typeof details.riskAccepted!=='boolean'||typeof details.termsVersion!=='string')throw invalid();
  if(value.status==='ACTIVE'&&(details.riskAccepted!==true||details.termsVersion!=='card-testnet-v1'||!id(value.cardId)||typeof value.approvalId!=='string'||!/^card_approval_[0-9a-f]{64}$/.test(value.approvalId)))throw invalid();
  if(value.challenge!==undefined){
    const challenge=value.challenge;
    if(!record(challenge)||challenge.applicationId!==value.id||challenge.owner!==account||challenge.chainId!=='0x1917'||challenge.purpose!=='create-testnet-card'||!id(challenge.id)||typeof challenge.nonce!=='string'||typeof challenge.payloadHash!=='string'||! /^[0-9a-f]{64}$/.test(challenge.payloadHash)||!date(challenge.issuedAt)||!date(challenge.expiresAt))throw invalid();
  }
  return value as unknown as CardApplicationView;
}
function card(value:unknown,account:string):TestnetCardView {
  if(!record(value)||!id(value.id)||!id(value.applicationId)||value.owner!==account||typeof value.alias!=='string'||!value.alias.startsWith('YNX TESTNET ')||!['ACTIVE','FROZEN','CLOSED'].includes(String(value.status))||!record(value.balance)||!record(value.controls)||!date(value.createdAt))throw invalid();
  const balance=value.balance;
  if(!['availableWei','pendingWei','postedWei','feeWei','fundedWei'].every(key=>wei(balance[key])))throw invalid();
  if(BigInt(String(balance.availableWei))+BigInt(String(balance.pendingWei))+BigInt(String(balance.postedWei))+BigInt(String(balance.feeWei))!==BigInt(String(balance.fundedWei)))throw invalid();
  if(value.fundingSender!==undefined&&(typeof value.fundingSender!=='string'||!/^0x[0-9a-f]{40}$/.test(value.fundingSender)))throw invalid();
  return value as unknown as TestnetCardView;
}
function funding(value:unknown,account:string):CardFundingView {
  if(!record(value)||!id(value.id)||!id(value.cardId)||value.owner!==account||value.chainId!=='0x1917'||typeof value.sender!=='string'||!/^0x[0-9a-f]{40}$/.test(value.sender)||typeof value.recipient!=='string'||!/^0x[0-9a-f]{40}$/.test(value.recipient)||!wei(value.amountWei)||BigInt(value.amountWei)<=0n||!Number.isSafeInteger(value.minConfirmations)||Number(value.minConfirmations)<1||!date(value.createdAt)||!date(value.expiresAt)||!['pending','credited'].includes(String(value.status)))throw invalid();
  if(value.status==='credited'){
    const receipt=value.receipt;
    if(typeof value.txHash!=='string'||!/^0x[0-9a-f]{64}$/.test(value.txHash)||!record(receipt)||receipt.chainId!=='0x1917'||receipt.txHash!==value.txHash||receipt.from!==value.sender||receipt.to!==value.recipient||receipt.amountWei!==value.amountWei||typeof receipt.blockHash!=='string'||!/^0x[0-9a-f]{64}$/.test(receipt.blockHash)||typeof receipt.blockNumber!=='string'||!/^0x[0-9a-f]+$/.test(receipt.blockNumber)||!Number.isSafeInteger(receipt.confirmations)||Number(receipt.confirmations)<Number(value.minConfirmations))throw invalid();
  }
  return value as unknown as CardFundingView;
}

/** Product-scoped transport. It never opens wallets, requests accounts, signs a
 * business approval/transaction, or changes a Standard Wallet connection. */
export class CardBusinessClient {
  private epoch=0;
  private flights=new Set<AbortController>();
  private transport:typeof fetch;
  private timeout:number;
  private platform:'web'|'ios'|'android';
  constructor(private capabilities:Capabilities){
    if(!/^[0-9a-f]{40}$/.test(capabilities.expectedSourceCommit))throw new CardBusinessError('CARD_API_SOURCE_NOT_CONFIGURED','configuration');
    this.platform=capabilities.platform??'web';
    if(!['web','ios','android'].includes(this.platform))throw new CardBusinessError('INVALID_CARD_PLATFORM','configuration');
    this.transport=capabilities.fetch??globalThis.fetch?.bind(globalThis);
    this.timeout=capabilities.timeoutMs??10000;
    if(typeof this.transport!=='function'||!Number.isSafeInteger(this.timeout)||this.timeout<1||this.timeout>10000)throw new CardBusinessError('CARD_API_TRANSPORT_UNAVAILABLE','configuration');
  }
  invalidate():void {this.epoch++;for(const controller of this.flights)controller.abort();this.flights.clear();}
  private context():CardPrivateIdentity {
    const value=this.capabilities.identity();
    if(!value||!owner(value.owner)||typeof value.sessionBinding!=='string'||!value.sessionBinding||!date(value.expiresAt)||Date.parse(value.expiresAt)<=Date.now())throw new CardBusinessError('PRIVATE_SESSION_REQUIRED','product-session');
    return {...value};
  }
  private async request<T>(scope:CardScope,method:'GET'|'POST'|'PATCH'|'PUT',path:string,parse:(data:unknown,owner:string)=>T,input?:unknown,key?:string):Promise<T>{
    if(!/^\/api\/card\/v1\/[A-Za-z0-9/_-]+$/.test(path))throw new CardBusinessError('INVALID_CARD_API_ROUTE','configuration');
    if(method!=='GET'&&(typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(key)))throw new CardBusinessError('IDEMPOTENCY_KEY_REQUIRED','configuration');
    rejectSensitive(input);
    const initial=this.context(),epoch=this.epoch,controller=new AbortController();this.flights.add(controller);
    let timedOut=false,phase:'product-session'|'card-api'='product-session';
    const active=()=>{const current=this.context();if(epoch!==this.epoch||current.owner!==initial.owner||current.sessionBinding!==initial.sessionBinding||controller.signal.aborted)throw new CardBusinessError('CARD_CONTEXT_CHANGED','context');};
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeout);
    const bounded=<V>(operation:Promise<V>):Promise<V>=>new Promise((resolve,reject)=>{
      const abort=()=>reject(new CardBusinessError(timedOut?(phase==='product-session'?'PRIVATE_SESSION_PROOF_TIMEOUT':'CARD_API_TIMEOUT'):'CARD_CONTEXT_CHANGED',timedOut?phase:'context',timedOut));
      if(controller.signal.aborted){void operation.catch(()=>{});abort();return;}
      controller.signal.addEventListener('abort',abort,{once:true});
      operation.then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort));
    });
    try{
      const proof=await bounded(this.capabilities.createIntrospectionProof([scope]));active();
      if(!proof||typeof proof.proofHeader!=='string'||! /^[A-Za-z0-9_-]{1,16384}$/.test(proof.proofHeader))throw new CardBusinessError('INVALID_PRIVATE_SESSION_PROOF','product-session');
      phase='card-api';
      const transport=this.transport;
      const response=await bounded(transport(CARD_BUSINESS_ORIGIN+path,{method,redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','X-YNX-Card-Platform':this.platform,'X-YNX-Product-Session-Proof-V2':proof.proofHeader,...(method==='GET'?{}:{'Content-Type':'application/json','Idempotency-Key':key!})},...(input===undefined?{}:{body:JSON.stringify(input)})}));active();
      const text=await bounded(response.text());active();
      if(new TextEncoder().encode(text).length>1048576||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''))throw invalid();
      let value:unknown;try{value=JSON.parse(text);}catch{throw invalid();}
      rejectSensitive(value);
      if(!response.ok){const code=record(value)&&record(value.error)&&typeof value.error.code==='string'&&/^[A-Z][A-Z0-9_]{1,79}$/.test(value.error.code)?value.error.code:'CARD_API_UNAVAILABLE';throw new CardBusinessError(code,response.status===401?'product-session':'card-api',response.status===429||response.status>=500);}
      if(!record(value)||value.schemaVersion!==1||value.environment!==ENVIRONMENT||value.productionRealPayments!==false||value.sourceCommit!==this.capabilities.expectedSourceCommit||value.sessionOwner!==initial.owner||!Object.hasOwn(value,'data'))throw invalid();
      return parse(value.data,initial.owner);
    }catch(error){if(error instanceof CardBusinessError)throw error;if(phase==='product-session')throw privateFailure(error);throw new CardBusinessError('CARD_API_UNAVAILABLE','card-api',true);}
    finally{clearTimeout(timer);this.flights.delete(controller);}
  }
  async state():Promise<CardBusinessSnapshot>{return this.request('account:read','GET','/api/card/v1/state',(value,account)=>{
    if(!record(value)||value.environment!==ENVIRONMENT||value.productionRealPayments!==false||value.asset!=='YNXT_TESTNET'||!Array.isArray(value.applications)||!Array.isArray(value.cards)||!Array.isArray(value.intents))throw invalid();
    const applications=value.applications.map(item=>application(item,account)),cards=value.cards.map(item=>card(item,account)),intents=value.intents.map(item=>funding(item,account));
    for(const item of cards){const app=applications.find(app=>app.id===item.applicationId);if(!app||app.status!=='ACTIVE'||app.cardId!==item.id)throw invalid();const total=intents.filter(intent=>intent.cardId===item.id&&intent.status==='credited').reduce((sum,intent)=>sum+BigInt(intent.amountWei),0n);if(total!==BigInt(item.balance.fundedWei))throw invalid();}
    return {environment:ENVIRONMENT,productionRealPayments:false,asset:'YNXT_TESTNET',applications,cards,intents};
  });}
  createApplication(details:ApplicationDetails,key:string):Promise<CardApplicationView>{return this.request('card:application:write','POST','/api/card/v1/applications',application,details,key);}
  updateApplication(applicationId:string,details:ApplicationDetails,key:string):Promise<CardApplicationView>{return this.request('card:application:write','PATCH',`/api/card/v1/applications/${this.resource(applicationId)}`,application,details,key);}
  requestApproval(applicationId:string,key:string):Promise<CardApplicationView>{return this.request('card:application:write','POST',`/api/card/v1/applications/${this.resource(applicationId)}/approval-request`,application,{},key);}
  submitApplication(applicationId:string,proof:unknown,key:string):Promise<Readonly<{application:CardApplicationView;card:TestnetCardView|null}>>{return this.request('card:application:write','POST',`/api/card/v1/applications/${this.resource(applicationId)}/submit`,(value,account)=>{
    if(!record(value))throw invalid();const app=application(value.application,account),created=value.card===null?null:card(value.card,account);if(created&&(app.status!=='ACTIVE'||app.cardId!==created.id||created.applicationId!==app.id||created.balance.fundedWei!=='0'))throw invalid();if(!created&&app.status==='ACTIVE')throw invalid();return {application:app,card:created};
  },{proof},key);}
  cancelApplication(applicationId:string,key:string):Promise<CardApplicationView>{return this.request('card:application:write','POST',`/api/card/v1/applications/${this.resource(applicationId)}/cancel`,application,{},key);}
  createTopupIntent(cardId:string,amountWei:string,key:string):Promise<CardFundingView>{return this.request('card:topup:write','POST',`/api/card/v1/cards/${this.resource(cardId)}/topup-intents`,funding,{amountWei},key);}
  confirmTopup(intentId:string,txHash:string,key:string):Promise<Readonly<{intent:CardFundingView;card:TestnetCardView}>>{return this.request('card:topup:write','POST','/api/card/v1/topups',(value,account)=>{if(!record(value))throw invalid();const intent=funding(value.intent,account),result=card(value.card,account);if(intent.cardId!==result.id||intent.status!=='credited'||intent.txHash!==txHash)throw invalid();return {intent,card:result};},{intentId:this.resource(intentId),txHash},key);}
  changeCard(cardId:string,action:'freeze'|'unfreeze'|'close'|'recover',key:string):Promise<TestnetCardView>{if(!['freeze','unfreeze','close','recover'].includes(action))throw new CardBusinessError('INVALID_CARD_ACTION','configuration');return this.request('card:controls:write','POST',`/api/card/v1/cards/${this.resource(cardId)}/${action}`,card,{},key);}
  updateControls(cardId:string,controls:ObjectValue,key:string):Promise<TestnetCardView>{return this.request('card:controls:write','PUT',`/api/card/v1/cards/${this.resource(cardId)}/controls`,card,controls,key);}
  private resource(value:string):string{if(!id(value))throw new CardBusinessError('INVALID_CARD_RESOURCE','configuration');return value;}
}
