import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {CardStore} from './storage.ts';
import {digestInput,subject} from './contracts.ts';

const ORIGIN='https://test.immersve.com';
const JWKS=ORIGIN+'/.well-known/jwks.json';
const id=(value:unknown):string=>{if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))throw Error('IMMERSVE_INVALID_ID');return value};
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('IMMERSVE_INVALID_RESPONSE');return value as Record<string,unknown>};
type Binding={accountId:string;fundingSourceId?:string;cardId?:string};
type Event={messageId:string;topic:string;contentHash:string;createdAt:string;receivedAt:string};
type DepositOperation={operationId:string;fingerprint:string;amount:string;fundingSourceId:string;status:'UNKNOWN'|'PROVIDER_RESPONSE_RECORDED';providerInteractionId?:string;outcome:'ATTEMPT_RESERVED'|'TRANSPORT_UNKNOWN'|'PROVIDER_NON_200'|'RESPONSE_INVALID'|'RESPONSE_RECORDED';createdAt:string;updatedAt:string;attempts:1;ledgerCredited:false};
type Journal={binding?:Binding;events:Record<string,Event>;operations?:Record<string,DepositOperation>};
const empty=():Journal=>({events:{},operations:{}});
export type ImmersveSandboxWriteGate={ticket:string;qaAccountId:string;expiresAt:string;maxDepositMinorUnits:string;maxProviderCalls:number};
export type ImmersveSandboxConfig={enabled:boolean;partnerAccountId:string;listenerId:string;apiKey?:string;apiSecret?:string;writeEnabled?:boolean;operatorGate?:ImmersveSandboxWriteGate};

/** Fixed Test-only endpoint. No arbitrary origin, redirects, PAN/CVV, or client-supplied account authority. */
export class ImmersveSandbox {
  private readonly store:CardStore;
  private readonly config:ImmersveSandboxConfig;
  private readonly transport:typeof fetch;
  constructor(options:{store:CardStore;config:ImmersveSandboxConfig;transport?:typeof fetch}){
    this.store=options.store;this.config={...options.config,partnerAccountId:id(options.config.partnerAccountId),listenerId:id(options.config.listenerId)};
    this.transport=options.transport??fetch;
  }
  static fromEnvironment(store:CardStore,env:NodeJS.ProcessEnv=process.env,transport?:typeof fetch){
    if(env.IMMERSVE_SANDBOX_ENABLED!==undefined&&!['true','false'].includes(env.IMMERSVE_SANDBOX_ENABLED))throw Error('IMMERSVE_INVALID_ENABLED');
    if(env.IMMERSVE_SANDBOX_WRITE_ENABLED!==undefined&&!['true','false'].includes(env.IMMERSVE_SANDBOX_WRITE_ENABLED))throw Error('IMMERSVE_INVALID_WRITE_ENABLED');
    if(env.IMMERSVE_SANDBOX_ORIGIN&&env.IMMERSVE_SANDBOX_ORIGIN!==ORIGIN)throw Error('IMMERSVE_TEST_ORIGIN_REQUIRED');
    const writeEnabled=env.IMMERSVE_SANDBOX_WRITE_ENABLED==='true';
    const operatorGate=writeEnabled?{ticket:env.IMMERSVE_SANDBOX_OPERATOR_TICKET??'',qaAccountId:env.IMMERSVE_SANDBOX_QA_ACCOUNT_ID??'',expiresAt:env.IMMERSVE_SANDBOX_WRITE_EXPIRES_AT??'',maxDepositMinorUnits:env.IMMERSVE_SANDBOX_MAX_DEPOSIT_MINOR_UNITS??'',maxProviderCalls:Number(env.IMMERSVE_SANDBOX_MAX_PROVIDER_CALLS??'0')}:undefined;
    return new ImmersveSandbox({store,config:{enabled:env.IMMERSVE_SANDBOX_ENABLED==='true',partnerAccountId:env.IMMERSVE_SANDBOX_PARTNER_ACCOUNT_ID??'UNCONFIGURED',listenerId:env.IMMERSVE_SANDBOX_LISTENER_ID??'UNCONFIGURED',apiKey:env.IMMERSVE_SANDBOX_API_KEY,apiSecret:env.IMMERSVE_SANDBOX_API_SECRET,writeEnabled,...(operatorGate?{operatorGate}:{})},...(transport?{transport}:{})});
  }
  doctor(){return {environment:'Immersve Test',origin:ORIGIN,enabled:this.config.enabled,credentialsConfigured:Boolean(this.config.apiKey&&this.config.apiSecret),partnerConfigured:this.config.partnerAccountId!=='UNCONFIGURED',listenerConfigured:this.config.listenerId!=='UNCONFIGURED',providerWritesEnabled:this.writeGateReady(),ynxtChainSupported:false,tusdSupported:false,cardLedgerCredited:false};}
  private writeGateReady(){const gate=this.config.operatorGate,expiry=Date.parse(gate?.expiresAt??'');return Boolean(this.config.enabled&&this.config.writeEnabled&&this.config.apiKey&&this.config.apiSecret&&gate&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(gate.ticket)&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(gate.qaAccountId)&&Number.isFinite(expiry)&&expiry>Date.now()&&expiry<=Date.now()+86400000&&/^[1-9][0-9]*$/.test(gate.maxDepositMinorUnits)&&BigInt(gate.maxDepositMinorUnits)<=100000000n&&Number.isSafeInteger(gate.maxProviderCalls)&&gate.maxProviderCalls>=1&&gate.maxProviderCalls<=10)}
  private state(owner:string){return this.store.read('immersve-sandbox:'+subject(owner),empty)}
  /** Trusted operator binding only. Never expose as an end-user route. */
  bindCardholder(owner:string,accountId:string){accountId=id(accountId);const exactOwner=subject(owner);return this.store.transaction('immersve-sandbox:'+exactOwner,empty,state=>{if(state.binding&&state.binding.accountId!==accountId)throw Error('IMMERSVE_BINDING_CONFLICT');this.store.claim('immersve-test-account',accountId,exactOwner,'cardholder');state.binding??={accountId};return state.binding})}
  bindResource(owner:string,kind:'fundingSourceId'|'cardId',resourceId:string){resourceId=id(resourceId);const exactOwner=subject(owner);return this.store.transaction('immersve-sandbox:'+exactOwner,empty,state=>{if(!state.binding)throw Error('IMMERSVE_ACCOUNT_UNBOUND');if(state.binding[kind]&&state.binding[kind]!==resourceId)throw Error('IMMERSVE_BINDING_CONFLICT');this.store.claim('immersve-test-'+kind,resourceId,exactOwner,kind);state.binding[kind]=resourceId;return state.binding})}
  private binding(owner:string){const binding=this.state(owner).binding;if(!binding)throw Error('IMMERSVE_ACCOUNT_UNBOUND');return binding}
  private async get(path:string,accountId?:string):Promise<Record<string,unknown>>{
    if(!this.config.enabled)throw Error('IMMERSVE_SANDBOX_DISABLED');
    if(!this.config.apiKey||!this.config.apiSecret)throw Error('IMMERSVE_CREDENTIALS_UNAVAILABLE');
    const response=await this.transport(ORIGIN+path,{method:'GET',headers:{'x-api-key':this.config.apiKey,'x-api-secret':this.config.apiSecret,...(accountId?{'x-account-id':accountId}:{})},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('IMMERSVE_READ_FAILED_'+response.status);
    const body=await response.text();if(body.length>262144)throw Error('IMMERSVE_RESPONSE_TOO_LARGE');return record(JSON.parse(body));
  }
  async listFundingSources(owner:string){const {accountId}=this.binding(owner),body=await this.get('/api/accounts/'+encodeURIComponent(accountId)+'/funding-sources',accountId);
    if(!Array.isArray(body.items))throw Error('IMMERSVE_INVALID_RESPONSE');
    return body.items.map(value=>{const item=record(value);if(item.accountId!==accountId)throw Error('IMMERSVE_ACCOUNT_MISMATCH');return {id:id(item.id),accountId,fundingChannelId:typeof item.fundingChannelId==='string'?id(item.fundingChannelId):null};});
  }
  async listFundingSourcesForAccount(accountId:string){accountId=id(accountId);const body=await this.get('/api/accounts/'+accountId+'/funding-sources',accountId);if(!Array.isArray(body.items))throw Error('IMMERSVE_INVALID_RESPONSE');return body.items.map(value=>{const item=record(value);if(item.accountId!==accountId)throw Error('IMMERSVE_ACCOUNT_MISMATCH');return {id:id(item.id),accountId,fundingChannelId:typeof item.fundingChannelId==='string'?id(item.fundingChannelId):null,balanceMinor:typeof item.balance==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(item.balance)?item.balance:null,balanceCurrency:typeof item.balanceCurrency==='string'?id(item.balanceCurrency):null}})}
  async readAccount(accountId:string){accountId=id(accountId);const body=await this.get('/api/accounts/'+accountId,accountId);if(body.id!==accountId||body.partnerAccountId!==this.config.partnerAccountId||body.type!=='cardholder'||body.liveness!=='test')throw Error('IMMERSVE_ACCOUNT_MISMATCH');if(typeof body.modifiedAt!=='string'||!Number.isFinite(Date.parse(body.modifiedAt)))throw Error('IMMERSVE_ACCOUNT_SOURCE_TIME_UNAVAILABLE');return {externalAccountId:accountId,status:body.isActive===true?'active':'inactive',sourceAsOf:body.modifiedAt}}
  async getBoundCard(owner:string){const {accountId,cardId}=this.binding(owner);if(!cardId)throw Error('IMMERSVE_CARD_UNBOUND');const body=await this.get('/api/cards/'+encodeURIComponent(cardId),accountId);
    if(body.accountId!==accountId||body.cardId!==cardId&&body.id!==cardId)throw Error('IMMERSVE_ACCOUNT_MISMATCH');
    return {cardId,accountId,status:typeof body.status==='string'?body.status:'UNKNOWN',provider:'Immersve Test',spendable:false};
  }
  /** These methods are called only by the Card lifecycle after its own owner,
   * program, Wallet approval and durable operation checks. */
  async readCard(accountId:string,cardId:string){accountId=id(accountId);cardId=id(cardId);const body=await this.get('/api/cards/'+cardId,accountId);
    if(body.accountId!==accountId||(body.cardId!==cardId&&body.id!==cardId))throw Error('IMMERSVE_CARD_READBACK_MISMATCH');
    const fundingSourceIds=Array.isArray(body.fundingSourceIds)?body.fundingSourceIds.map(id):[];
    return {cardId,accountId,status:typeof body.status==='string'?body.status:'unknown',isBlocked:typeof body.isBlocked==='boolean'?body.isBlocked:null,cardProgramId:typeof body.cardProgramId==='string'?body.cardProgramId:null,fundingSourceIds,lastFour:typeof body.panLast4==='string'&&/^\d{4}$/.test(body.panLast4)?body.panLast4:null,sourceAsOf:typeof body.modifiedAt==='string'&&Number.isFinite(Date.parse(body.modifiedAt))?body.modifiedAt:null};
  }
  async listAccountCards(accountId:string,cursor?:string){accountId=id(accountId);if(cursor!==undefined&&(cursor.length>512||!/^[A-Za-z0-9._~:-]+$/.test(cursor)))throw Error('IMMERSVE_INVALID_CURSOR');const body=await this.get('/api/accounts/'+accountId+'/cards?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),accountId);
    if(!Array.isArray(body.items))throw Error('IMMERSVE_INVALID_RESPONSE');return {items:body.items.map(value=>{const item=record(value);if(item.accountId!==accountId)throw Error('IMMERSVE_ACCOUNT_MISMATCH');return {cardId:id(item.cardId??item.id),cardProgramId:id(item.cardProgramId),fundingSourceIds:Array.isArray(item.fundingSourceIds)?item.fundingSourceIds.map(id):[],status:typeof item.status==='string'?item.status:'unknown',isBlocked:typeof item.isBlocked==='boolean'?item.isBlocked:null}}),nextCursor:typeof record(body.pageInfo??{}).nextCursor==='string'?String(record(body.pageInfo).nextCursor):null};
  }
  async listAccountTransactions(accountId:string,cursor?:string){accountId=id(accountId);if(cursor!==undefined&&(cursor.length>512||!/^[A-Za-z0-9._~:-]+$/.test(cursor)))throw Error('IMMERSVE_INVALID_CURSOR');const body=await this.get('/api/accounts/'+accountId+'/transactions?limit=100&statuses=all'+(cursor?'&cursor='+encodeURIComponent(cursor):''),accountId);
    if(!Array.isArray(body.items))throw Error('IMMERSVE_INVALID_RESPONSE');return {items:body.items.map(value=>record(value)),nextCursor:typeof record(body.pageInfo??{}).nextCursor==='string'?String(record(body.pageInfo).nextCursor):null};
  }
  async readTransaction(accountId:string,transactionId:string){accountId=id(accountId);transactionId=id(transactionId);return this.get('/api/transactions/'+transactionId,accountId)}
  async submitCard(accountId:string,programId:string,fundingSourceId:string){accountId=id(accountId);programId=id(programId);fundingSourceId=id(fundingSourceId);
    if(!this.writeGateReady()||this.config.operatorGate?.qaAccountId!==accountId)throw Error('IMMERSVE_TEST_WRITE_GATE_CLOSED');
    const response=await this.transport(ORIGIN+'/api/cards',{method:'POST',headers:{'content-type':'application/json','x-api-key':this.config.apiKey!,'x-api-secret':this.config.apiSecret!,'x-account-id':accountId},body:JSON.stringify({cardProgramId:programId,fundingSourceId}),redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('IMMERSVE_CARD_SUBMIT_UNKNOWN');const raw=await response.text();if(raw.length>262144)throw Error('IMMERSVE_CARD_SUBMIT_UNKNOWN');const body=record(JSON.parse(raw));return id(body.cardId);
  }
  async setCardFrozen(accountId:string,cardId:string,frozen:boolean){accountId=id(accountId);cardId=id(cardId);if(!this.writeGateReady()||this.config.operatorGate?.qaAccountId!==accountId)throw Error('IMMERSVE_TEST_WRITE_GATE_CLOSED');
    const response=await this.transport(ORIGIN+'/api/cards/'+cardId+'/'+(frozen?'freeze':'unfreeze'),{method:'POST',headers:{'x-api-key':this.config.apiKey!,'x-api-secret':this.config.apiSecret!,'x-account-id':accountId},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('IMMERSVE_CARD_CONTROL_UNKNOWN');
  }
  async listWebhookDeliveryStatus(){const body=await this.get('/api/accounts/'+encodeURIComponent(this.config.partnerAccountId)+'/webhook-notifications');
    if(!Array.isArray(body.items))throw Error('IMMERSVE_INVALID_RESPONSE');return body.items.map(value=>{const item=record(value);return {messageId:id(item.messageId),deliveryStatus:typeof item.deliveryStatus==='string'?item.deliveryStatus:'UNKNOWN'};});
  }
  /** The public Execute Simulator Deposit model contains exactly these two fields. */
  planSimulatorDeposit(owner:string,input:{amount:string;fundingSourceId:string}){
    const binding=this.binding(owner),fundingSourceId=id(input.fundingSourceId);
    if(binding.fundingSourceId!==fundingSourceId)throw Error('IMMERSVE_FUNDING_SOURCE_UNBOUND');
    if(typeof input.amount!=='string'||! /^[1-9][0-9]*$/.test(input.amount))throw Error('IMMERSVE_INVALID_AMOUNT');
    return {amount:input.amount,fundingSourceId} as const;
  }
  private updateDeposit(owner:string,operationId:string,fingerprint:string,outcome:DepositOperation['outcome'],providerInteractionId?:string){
    return this.store.transaction('immersve-sandbox:'+subject(owner),empty,state=>{const operation=state.operations?.[operationId];if(!operation||operation.fingerprint!==fingerprint)throw Error('IMMERSVE_OPERATION_CHANGED');if(operation.status==='PROVIDER_RESPONSE_RECORDED')return operation;operation.outcome=outcome;operation.updatedAt=new Date().toISOString();if(providerInteractionId){operation.status='PROVIDER_RESPONSE_RECORDED';operation.providerInteractionId=providerInteractionId}return operation});
  }
  getDepositOperation(owner:string,operationId:string){return this.state(owner).operations?.[id(operationId)]??null}
  /** A durable UNKNOWN reservation precedes the sole provider attempt; retrying this ID never sends again. */
  async executeSimulatorDeposit(owner:string,operationId:string,input:{amount:string;fundingSourceId:string}){
    const body=this.planSimulatorDeposit(owner,input),binding=this.binding(owner),gate=this.config.operatorGate;
    if(!this.writeGateReady()||!gate||binding.accountId!==gate.qaAccountId)throw Error('IMMERSVE_TEST_WRITE_GATE_CLOSED');
    if(BigInt(body.amount)>BigInt(gate.maxDepositMinorUnits))throw Error('IMMERSVE_VIRTUAL_AMOUNT_CAP');
    operationId=id(operationId);const fingerprint=hash(JSON.stringify(digestInput(body))),now=new Date().toISOString();
    const reserved=this.store.transaction('immersve-sandbox:'+subject(owner),empty,state=>{state.operations??={};const prior=state.operations[operationId];if(prior){if(prior.fingerprint!==fingerprint)throw Error('IMMERSVE_OPERATION_CONFLICT');return {fresh:false,operation:prior}}if(Object.keys(state.operations).length>=gate.maxProviderCalls)throw Error('IMMERSVE_PROVIDER_CALL_CAP');const operation:DepositOperation={operationId,fingerprint,...body,status:'UNKNOWN',outcome:'ATTEMPT_RESERVED',createdAt:now,updatedAt:now,attempts:1,ledgerCredited:false};state.operations[operationId]=operation;return {fresh:true,operation}});
    if(!reserved.fresh)return reserved.operation;
    try{
      const response=await this.transport(ORIGIN+'/api/simulator/execute-deposit',{method:'POST',headers:{'content-type':'application/json','x-api-key':this.config.apiKey!,'x-api-secret':this.config.apiSecret!,'x-account-id':binding.accountId},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
      if(!response.ok)return this.updateDeposit(owner,operationId,fingerprint,'PROVIDER_NON_200');
      const text=await response.text();if(text.length>262144)return this.updateDeposit(owner,operationId,fingerprint,'RESPONSE_INVALID');
      const receipt=record(JSON.parse(text));
      if(receipt.accountId!==binding.accountId||receipt.fundingSourceId!==body.fundingSourceId||receipt.amount!==body.amount||receipt.type!=='Deposit'||typeof receipt.id!=='string')return this.updateDeposit(owner,operationId,fingerprint,'RESPONSE_INVALID');
      return this.updateDeposit(owner,operationId,fingerprint,'RESPONSE_RECORDED',id(receipt.id));
    }catch{return this.updateDeposit(owner,operationId,fingerprint,'TRANSPORT_UNKNOWN')}
  }
  /** Read-only recovery evidence; never attribute a matching amount to an UNKNOWN operation. */
  async listDepositInteractions(owner:string,cursor?:string){
    const binding=this.binding(owner),fundingSourceId=binding.fundingSourceId;if(!fundingSourceId)throw Error('IMMERSVE_FUNDING_SOURCE_UNBOUND');
    if(cursor!==undefined&&(typeof cursor!=='string'||cursor.length<1||cursor.length>512||/[\s\x00-\x1f]/.test(cursor)))throw Error('IMMERSVE_INVALID_CURSOR');
    const query='?limit=100&type=Deposit'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
    const body=await this.get('/api/funding-sources/'+encodeURIComponent(fundingSourceId)+'/interactions'+query,binding.accountId);
    if(!Array.isArray(body.items))throw Error('IMMERSVE_INVALID_RESPONSE');
    const items=body.items.map(value=>{const item=record(value);if(item.accountId!==binding.accountId||item.fundingSourceId!==fundingSourceId||item.type!=='Deposit')throw Error('IMMERSVE_ACCOUNT_MISMATCH');return {id:id(item.id),accountId:binding.accountId,fundingSourceId,type:'Deposit' as const,status:typeof item.status==='string'?item.status:'UNKNOWN',amount:typeof item.amount==='string'?item.amount:'',token:typeof item.token==='string'?item.token:'',attribution:'UNVERIFIED' as const,ledgerCredited:false as const}});
    const pageInfo=body.pageInfo?record(body.pageInfo):{},nextCursor=typeof pageInfo.nextCursor==='string'?pageInfo.nextCursor:null;
    return {items,nextCursor,attribution:'UNVERIFIED' as const,ledgerCredited:false as const};
  }
  /** Card issuing and funding-source provisioning remain outside the bounded Test deposit slice. */
  createFundingSource():never{throw Error('IMMERSVE_PROVIDER_WRITE_NOT_AUTHORIZED')}
  createCard():never{throw Error('IMMERSVE_PROVIDER_WRITE_NOT_AUTHORIZED')}
  /** Signature is over the original raw bytes. The journal stores metadata only, never payment or card payloads. */
  async acceptWebhook(owner:string,topicPath:string,headers:Record<string,string|undefined>,rawBody:Buffer){
    if(!this.config.enabled)throw Error('IMMERSVE_SANDBOX_DISABLED');
    if(rawBody.length>262144)throw Error('IMMERSVE_WEBHOOK_TOO_LARGE');
    const delivery=id(headers['x-delivery-id']?.split(':')[0]),attempt=Number(headers['x-delivery-id']?.split(':')[1]);
    const keyId=id(headers['x-key-id']),signature=headers['x-signature'];
    if(!Number.isSafeInteger(attempt)||attempt<1||!signature||! /^[A-Za-z0-9+/]+={0,2}$/.test(signature))throw Error('IMMERSVE_INVALID_SIGNATURE');
    const keysResponse=await this.transport(JWKS,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!keysResponse.ok)throw Error('IMMERSVE_JWKS_UNAVAILABLE');
    const jwks=record(await keysResponse.json()),keys=jwks.keys;
    if(!Array.isArray(keys))throw Error('IMMERSVE_JWKS_INVALID');
    const jwk=keys.find(value=>{const key=record(value);return key.kid===keyId&&key.kty==='RSA'&&typeof key.n==='string'&&typeof key.e==='string'&&(!key.alg||key.alg==='RS256')}) as Record<string,unknown>|undefined;
    if(!jwk)throw Error('IMMERSVE_SIGNING_KEY_UNKNOWN');
    const signed=Buffer.concat([Buffer.from(headers['x-delivery-id']+':'+keyId+':'),rawBody]);
    if(!verifySignature('RSA-SHA256',signed,createPublicKey({key:jwk as any,format:'jwk'}),Buffer.from(signature,'base64')))throw Error('IMMERSVE_INVALID_SIGNATURE');
    const envelope=record(JSON.parse(rawBody.toString('utf8'))),payload=record(envelope.payload),binding=this.binding(owner);
    if(envelope.messageId!==delivery||envelope.deliveryAttempt!==attempt||envelope.keyId!==keyId||envelope.issuer!=='test.immersve.com'||envelope.listenerId!==this.config.listenerId||envelope.listenerAccountId!==this.config.partnerAccountId||envelope.topic!==topicPath||payload.accountId!==binding.accountId)throw Error('IMMERSVE_WEBHOOK_BINDING_MISMATCH');
    id(topicPath);if(typeof envelope.createdAt!=='string'||!Number.isFinite(Date.parse(envelope.createdAt)))throw Error('IMMERSVE_INVALID_EVENT_TIME');const receivedAt=new Date().toISOString();
    // Delivery attempt, sentAt, keyId and raw JSON ordering may change on a
    // valid retry. The event identity and its business payload must not.
    const contentHash=hash(JSON.stringify(digestInput({messageId:delivery,topic:envelope.topic,listenerId:envelope.listenerId,listenerAccountId:envelope.listenerAccountId,issuer:envelope.issuer,createdAt:envelope.createdAt,payload})));
    return this.store.transaction('immersve-sandbox:'+subject(owner),empty,state=>{if(state.binding?.accountId!==binding.accountId)throw Error('IMMERSVE_ACCOUNT_CHANGED');const previous=state.events[delivery];if(previous){if(previous.contentHash!==contentHash)throw Error('IMMERSVE_WEBHOOK_REPLAY_CONFLICT');return {duplicate:true,messageId:delivery,ledgerCredited:false}}state.events[delivery]={messageId:delivery,topic:topicPath,contentHash,createdAt:String(envelope.createdAt),receivedAt};return {duplicate:false,messageId:delivery,ledgerCredited:false}});
  }
  eventJournal(owner:string){return Object.values(this.state(owner).events)}
}
