import {CARD_BUSINESS_ORIGIN,type CardPrivateIdentity} from './cardBusinessClient';

export class CardProviderClientError extends Error{constructor(readonly code:string,readonly layer:'product-session'|'card-api'|'card-data'){super(code)}}
type Capabilities={expectedSourceCommit:string;identity:()=>CardPrivateIdentity|null;createIntrospectionProof:(scopes:readonly string[])=>Promise<{proofHeader:string}>;fetch?:typeof fetch;platform?:'web'|'ios'|'android';allowedHostedOrigins?:readonly string[]};
type RequestOptions={method:'GET'|'POST';scope:'account:read'|'card:application:write';body?:unknown;idempotencyKey?:string};
const pathPrefix='/api/card/v2';
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new CardProviderClientError('INVALID_CARD_API_RESPONSE','card-data');return value as Record<string,unknown>}
function rejectSensitive(value:unknown):void{if(Array.isArray(value)){value.forEach(rejectSensitive);return}if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(/^(pan|cvv|cvc|pin|seed|mnemonic|privateKey|cryptogram|trackData|fullCardNumber|identityDocument|dateOfBirth)$/i.test(key))throw new CardProviderClientError('SENSITIVE_CARD_DATA_REJECTED','card-data');rejectSensitive(child)}}
function resource(value:string):string{if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw new CardProviderClientError('INVALID_CARD_RESOURCE','card-data');return encodeURIComponent(value)}
export class CardProviderClient{
  private readonly fetcher:typeof fetch;
  constructor(private readonly capabilities:Capabilities){if(!/^[a-f0-9]{40}$/.test(capabilities.expectedSourceCommit))throw new CardProviderClientError('SOURCE_NOT_CONFIGURED','card-data');this.fetcher=capabilities.fetch??globalThis.fetch}
  private async request(path:string,options:RequestOptions):Promise<unknown>{
    const start=this.capabilities.identity();if(!start||!start.owner||!start.sessionBinding||Date.parse(start.expiresAt)<=Date.now())throw new CardProviderClientError('PRIVATE_SESSION_REQUIRED','product-session');
    if(options.method==='POST'&&(!options.idempotencyKey||! /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(options.idempotencyKey)))throw new CardProviderClientError('IDEMPOTENCY_KEY_REQUIRED','card-data');
    let proof:{proofHeader:string};try{proof=await this.capabilities.createIntrospectionProof([options.scope])}catch{throw new CardProviderClientError('PRIVATE_SESSION_PROOF_UNAVAILABLE','product-session')}
    const current=this.capabilities.identity();if(!current||current.owner!==start.owner||current.sessionBinding!==start.sessionBinding)throw new CardProviderClientError('CARD_CONTEXT_CHANGED','product-session');
    const headers=new Headers({'Accept':'application/json','X-YNX-Product-Session-Proof-V2':proof.proofHeader,'X-YNX-Card-Platform':this.capabilities.platform??'web'});
    if(options.body!==undefined)headers.set('Content-Type','application/json');if(options.idempotencyKey)headers.set('Idempotency-Key',options.idempotencyKey);
    let response:Response;try{response=await this.fetcher(CARD_BUSINESS_ORIGIN+path,{method:options.method,headers,body:options.body===undefined?undefined:JSON.stringify(options.body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)})}catch{throw new CardProviderClientError('CARD_API_UNAVAILABLE','card-api')}
    const after=this.capabilities.identity();if(!after||after.owner!==start.owner||after.sessionBinding!==start.sessionBinding)throw new CardProviderClientError('CARD_CONTEXT_CHANGED','product-session');
    if(!response.headers.get('content-type')?.startsWith('application/json'))throw new CardProviderClientError('INVALID_CARD_API_RESPONSE','card-data');
    let parsed:Record<string,unknown>;try{parsed=object(await response.json())}catch{throw new CardProviderClientError('INVALID_CARD_API_RESPONSE','card-data')}
    if(!response.ok){const error=object(parsed.error);const code=typeof error.code==='string'&&/^[A-Z0-9_]{3,80}$/.test(error.code)?error.code:'CARD_API_UNAVAILABLE';throw new CardProviderClientError(code,response.status===401||response.status===403?'product-session':'card-api')}
    if(parsed.schemaVersion!==2||parsed.sourceCommit!==this.capabilities.expectedSourceCommit||parsed.sessionOwner!==start.owner||parsed.environment!=='YNX_TESTNET_CARD_PAYMENT_SIMULATION'||parsed.productionRealPayments!==false)throw new CardProviderClientError('INVALID_CARD_API_RESPONSE','card-data');
    rejectSensitive(parsed.data);return parsed.data;
  }
  listApplications(){return this.request(pathPrefix+'/provider-applications',{method:'GET',scope:'account:read'})}
  getApplication(id:string){return this.request(pathPrefix+'/provider-applications/'+resource(id),{method:'GET',scope:'account:read'})}
  createDraft(input:unknown,idempotencyKey:string){return this.request(pathPrefix+'/provider-applications',{method:'POST',scope:'card:application:write',body:input,idempotencyKey})}
  acknowledgeTerms(id:string,input:unknown,idempotencyKey:string){return this.request(pathPrefix+'/provider-applications/'+resource(id)+'/terms',{method:'POST',scope:'card:application:write',body:input,idempotencyKey})}
  async beginHostedKyc(id:string,idempotencyKey:string){const result=object(await this.request(pathPrefix+'/provider-applications/'+resource(id)+'/hosted-kyc',{method:'POST',scope:'card:application:write',body:{},idempotencyKey}));const url=result.hostedUrl;if(url!==null&&url!==undefined){if(typeof url!=='string')throw new CardProviderClientError('HOSTED_KYC_RESPONSE_UNTRUSTED','card-data');let parsed:URL;try{parsed=new URL(url)}catch{throw new CardProviderClientError('HOSTED_KYC_RESPONSE_UNTRUSTED','card-data')}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||!this.capabilities.allowedHostedOrigins?.includes(parsed.origin))throw new CardProviderClientError('HOSTED_KYC_RESPONSE_UNTRUSTED','card-data')}return result}
  cancelLocal(id:string,idempotencyKey:string){return this.request(pathPrefix+'/provider-applications/'+resource(id)+'/cancel',{method:'POST',scope:'card:application:write',body:{},idempotencyKey})}
  overview(){return this.request(pathPrefix+'/provider-overview',{method:'GET',scope:'account:read'})}
  activity(cardId:string,cursor=0,limit=50){if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new CardProviderClientError('INVALID_ACTIVITY_PAGE','card-data');return this.request(pathPrefix+'/cards/'+resource(cardId)+'/provider-activity?cursor='+cursor+'&limit='+limit,{method:'GET',scope:'account:read'})}
}
