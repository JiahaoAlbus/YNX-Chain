import {createHash,randomUUID} from 'node:crypto';
import {CardError,type Principal} from './contracts.ts';
import {CardStore} from './storage.ts';
import type {CardProvider} from './providerRegistry.ts';

export type ProviderApplicationStatus='DRAFT'|'KYC_REQUIRED'|'KYC_SESSION_UNKNOWN'|'KYC_PENDING'|'KYC_REVIEW'|'APPROVAL_REQUIRED'|'PROVIDER_PENDING'|'ACTIVE_SANDBOX'|'REJECTED'|'CANCELLED'|'DEGRADED';
export type ProviderApplication={id:string;owner:string;provider:CardProvider;programId:string;providerEnvironment:'TEST';nickname:string;useCase:string;testSpendingLimitMinor:string;cardAccountCurrency:string;minorUnitDigits:number;termsVersion:string;termsHash:string;feeDisclosureHash:string;riskAccepted:boolean;status:ProviderApplicationStatus;hostedKycSessionId:string|null;hostedKycSourceAsOf:string|null;upstreamApplicationId:null;upstreamCardId:null;upstreamCancellationConfirmed:false;walletApprovalVerified:false;createdAt:string;updatedAt:string;audit:{eventId:string;type:string;at:string}[]};
type State={applications:Record<string,ProviderApplication>;idempotency:Record<string,{digest:string;applicationId:string}>;kycEventIds:Record<string,string>};
export type HostedKycStart={url:string;sessionId:string;expiresAt:string};
export interface HostedKycAdapter{begin(application:Readonly<ProviderApplication>):Promise<HostedKycStart>}
export type VerifiedKycEvent={eventId:string;owner:string;applicationId:string;provider:CardProvider;programId:string;environment:'TEST';sessionId:string;status:'PENDING'|'REVIEW'|'APPROVED'|'REJECTED';sourceAsOf:string};
export interface HostedKycVerifier{verify(raw:Uint8Array,headers:Readonly<Record<string,string>>):Promise<VerifiedKycEvent>}
export type ProviderProgramTerms={provider:CardProvider;programId:string;environment:'TEST';termsVersion:string;termsHash:string;feeDisclosureHash:string;cardAccountCurrency:string;minorUnitDigits:number;enabled:boolean};
const empty=():State=>({applications:{},idempotency:{},kycEventIds:{}});
const key=(owner:string)=>'card-provider-application:'+owner;
const text=(value:unknown,name:string,max=128)=>{if(typeof value!=='string'||value.trim()!==value||value.length<1||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new CardError('INVALID_'+name,400);return value};
const ref=(value:unknown,name:string)=>{const s=text(value,name);if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s))throw new CardError('INVALID_'+name,400);return s};
const hash=(value:unknown,name:string)=>{if(typeof value!=='string'||! /^(?:sha256:)?[a-f0-9]{64}$/.test(value))throw new CardError('INVALID_'+name,400);return value};
const iso=(value:unknown)=>{if(typeof value!=='string'||! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw new CardError('INVALID_TIMESTAMP',400);return value};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const provider=(value:unknown):CardProvider=>{if(value!=='immersve'&&value!=='lithic')throw new CardError('CARD_PROVIDER_UNSUPPORTED',400);return value};
function requireOwner(principal:Principal){if(typeof principal.owner!=='string'||!principal.owner)throw new CardError('CARD_OWNER_INVALID',400)}
function safe(application:ProviderApplication):ProviderApplication{return structuredClone(application)}

/** Test-only application record. No upstream issuance, KYC assertion, wallet
 * approval, card activation, or funding authority is inferred from this state. */
export class CardProviderApplications{
  constructor(private readonly store:CardStore,private readonly hostedKyc?:HostedKycAdapter,private readonly verifier?:HostedKycVerifier,private readonly allowedHostedOrigins:readonly string[]=[],private readonly programs:readonly ProviderProgramTerms[]=[]){}
  list(principal:Principal){requireOwner(principal);return Object.values(this.store.read(key(principal.owner),empty).applications).map(safe)}
  get(principal:Principal,id:string){requireOwner(principal);ref(id,'APPLICATION_ID');const app=this.store.read(key(principal.owner),empty).applications[id];if(!app)throw new CardError('PROVIDER_APPLICATION_NOT_FOUND',404);return safe(app)}
  createDraft(principal:Principal,input:{provider:CardProvider;programId:string;nickname:string;useCase:string;testSpendingLimitMinor:string;cardAccountCurrency:string;minorUnitDigits:number;termsVersion:string;termsHash:string;feeDisclosureHash:string;riskAccepted:boolean},idempotencyKey:string,now=new Date().toISOString()){
    requireOwner(principal);const p=provider(input.provider),programId=ref(input.programId,'PROGRAM_ID'),nickname=text(input.nickname,'NICKNAME',40),useCase=text(input.useCase,'USE_CASE',160),termsVersion=ref(input.termsVersion,'TERMS_VERSION'),termsHash=hash(input.termsHash,'TERMS_HASH'),feeDisclosureHash=hash(input.feeDisclosureHash,'FEE_HASH');
    const limit=input.testSpendingLimitMinor;if(typeof limit!=='string'||! /^(0|[1-9][0-9]{0,17})$/.test(limit)||BigInt(limit)<=0n)throw new CardError('INVALID_TEST_SPENDING_LIMIT',400);
    if(typeof input.cardAccountCurrency!=='string'||! /^[A-Z]{3}$/.test(input.cardAccountCurrency)||!Number.isInteger(input.minorUnitDigits)||input.minorUnitDigits<0||input.minorUnitDigits>9)throw new CardError('INVALID_CARD_ACCOUNT_UNIT',400);
    const matching=this.programs.filter(candidate=>candidate.provider===p&&candidate.programId===programId&&candidate.environment==='TEST'&&candidate.enabled);
    if(matching.length!==1)throw new CardError('PROVIDER_PROGRAM_NOT_CONFIGURED',503);
    const accepted=matching[0]!;if(accepted.termsVersion!==termsVersion||accepted.termsHash!==termsHash||accepted.feeDisclosureHash!==feeDisclosureHash||accepted.cardAccountCurrency!==input.cardAccountCurrency||accepted.minorUnitDigits!==input.minorUnitDigits)throw new CardError('PROVIDER_DISCLOSURE_MISMATCH',409);
    if(input.riskAccepted!==true)throw new CardError('TESTNET_RISK_ACKNOWLEDGEMENT_REQUIRED',400);ref(idempotencyKey,'IDEMPOTENCY_KEY');iso(now);
    const fields={provider:p,programId,nickname,useCase,testSpendingLimitMinor:limit,cardAccountCurrency:input.cardAccountCurrency,minorUnitDigits:input.minorUnitDigits,termsVersion,termsHash,feeDisclosureHash,riskAccepted:true};const inputDigest=digest(fields);
    return this.store.transaction(key(principal.owner),empty,state=>{const prior=state.idempotency[idempotencyKey];if(prior){if(prior.digest!==inputDigest)throw new CardError('APPLICATION_IDEMPOTENCY_CONFLICT');return safe(state.applications[prior.applicationId]!)}
      const id=randomUUID(),application:ProviderApplication={id,owner:principal.owner,...fields,providerEnvironment:'TEST',status:'DRAFT',hostedKycSessionId:null,hostedKycSourceAsOf:null,upstreamApplicationId:null,upstreamCardId:null,upstreamCancellationConfirmed:false,walletApprovalVerified:false,createdAt:now,updatedAt:now,audit:[{eventId:randomUUID(),type:'DRAFT_CREATED_LOCAL',at:now}]};state.applications[id]=application;state.idempotency[idempotencyKey]={digest:inputDigest,applicationId:id};return application});
  }
  acknowledgeTerms(principal:Principal,applicationId:string,input:{termsVersion:string;termsHash:string;feeDisclosureHash:string;riskAccepted:boolean},now=new Date().toISOString()){
    requireOwner(principal);ref(applicationId,'APPLICATION_ID');iso(now);if(input.riskAccepted!==true)throw new CardError('TESTNET_RISK_ACKNOWLEDGEMENT_REQUIRED',400);
    return this.store.transaction(key(principal.owner),empty,state=>{const app=state.applications[applicationId];if(!app)throw new CardError('PROVIDER_APPLICATION_NOT_FOUND',404);if(app.termsVersion!==input.termsVersion||app.termsHash!==input.termsHash||app.feeDisclosureHash!==input.feeDisclosureHash)throw new CardError('PROVIDER_TERMS_CHANGED',409);if(app.status==='KYC_REQUIRED')return app;if(app.status!=='DRAFT')throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT');app.status='KYC_REQUIRED';app.updatedAt=now;app.audit.push({eventId:randomUUID(),type:'TEST_TERMS_ACKNOWLEDGED_LOCAL',at:now});return app});
  }
  async beginHostedKyc(principal:Principal,applicationId:string,now=new Date().toISOString()):Promise<{application:ProviderApplication;hostedUrl:string|null}>{
    requireOwner(principal);ref(applicationId,'APPLICATION_ID');iso(now);
    if(!this.hostedKyc||this.allowedHostedOrigins.length===0){const application=this.store.transaction(key(principal.owner),empty,state=>{const app=state.applications[applicationId];if(!app)throw new CardError('PROVIDER_APPLICATION_NOT_FOUND',404);if(app.status!=='KYC_REQUIRED'&&app.status!=='DEGRADED')throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT');app.status='DEGRADED';app.updatedAt=now;app.audit.push({eventId:randomUUID(),type:'HOSTED_KYC_ADAPTER_UNAVAILABLE',at:now});return app});return {application,hostedUrl:null}}
    const pending=this.store.transaction(key(principal.owner),empty,state=>{const app=state.applications[applicationId];if(!app)throw new CardError('PROVIDER_APPLICATION_NOT_FOUND',404);if(app.status!=='KYC_REQUIRED'&&app.status!=='DEGRADED')throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT');app.status='KYC_SESSION_UNKNOWN';app.updatedAt=now;app.audit.push({eventId:randomUUID(),type:'HOSTED_KYC_BEGIN_ATTEMPT',at:now});return app});
    let session:HostedKycStart;try{session=await this.hostedKyc.begin(pending)}catch{throw new CardError('HOSTED_KYC_OUTCOME_UNKNOWN',503)}
    const url=new URL(session.url);if(url.protocol!=='https:'||url.username||url.password||url.hash||!this.allowedHostedOrigins.includes(url.origin)||!session.sessionId||Date.parse(iso(session.expiresAt))<=Date.parse(now))throw new CardError('HOSTED_KYC_RESPONSE_UNTRUSTED',503);
    const sessionId=ref(session.sessionId,'KYC_SESSION_ID');const application=this.store.transaction(key(principal.owner),empty,state=>{const app=state.applications[applicationId];if(!app||app.status!=='KYC_SESSION_UNKNOWN')throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT');app.hostedKycSessionId=sessionId;app.status='KYC_PENDING';app.updatedAt=now;app.audit.push({eventId:randomUUID(),type:'HOSTED_KYC_SESSION_RECORDED',at:now});return app});return {application,hostedUrl:url.toString()};
  }
  async acceptVerifiedKyc(principal:Principal,raw:Uint8Array,headers:Readonly<Record<string,string>>,now=new Date().toISOString()){
    requireOwner(principal);iso(now);if(!this.verifier)throw new CardError('HOSTED_KYC_VERIFIER_UNAVAILABLE',503);const event=await this.verifier.verify(raw,headers);ref(event.eventId,'KYC_EVENT_ID');ref(event.applicationId,'APPLICATION_ID');ref(event.sessionId,'KYC_SESSION_ID');iso(event.sourceAsOf);if(event.owner!==principal.owner||event.environment!=='TEST')throw new CardError('HOSTED_KYC_BINDING_MISMATCH',403);
    return this.store.transaction(key(principal.owner),empty,state=>{const app=state.applications[event.applicationId];if(!app||app.provider!==event.provider||app.programId!==event.programId||app.hostedKycSessionId!==event.sessionId)throw new CardError('HOSTED_KYC_BINDING_MISMATCH',403);const prior=state.kycEventIds[event.eventId];if(prior){if(prior!==digest(event))throw new CardError('HOSTED_KYC_REPLAY_CONFLICT');return app}if(!['KYC_PENDING','KYC_REVIEW'].includes(app.status))throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT');
      state.kycEventIds[event.eventId]=digest(event);app.hostedKycSourceAsOf=event.sourceAsOf;app.status=event.status==='APPROVED'?'APPROVAL_REQUIRED':event.status==='REJECTED'?'REJECTED':event.status==='REVIEW'?'KYC_REVIEW':'KYC_PENDING';app.updatedAt=now;app.audit.push({eventId:event.eventId,type:'VERIFIED_KYC_'+event.status,at:now});return app});
  }
  cancelLocal(principal:Principal,applicationId:string,now=new Date().toISOString()){
    requireOwner(principal);ref(applicationId,'APPLICATION_ID');iso(now);return this.store.transaction(key(principal.owner),empty,state=>{const app=state.applications[applicationId];if(!app)throw new CardError('PROVIDER_APPLICATION_NOT_FOUND',404);if(app.status==='CANCELLED')return app;if(app.status==='ACTIVE_SANDBOX')throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT');app.status='CANCELLED';app.updatedAt=now;app.audit.push({eventId:randomUUID(),type:'CANCELLED_LOCAL_UPSTREAM_UNCONFIRMED',at:now});return app});
  }
  doctor(){return {schemaVersion:2,configuredTestPrograms:this.programs.filter(program=>program.enabled&&program.environment==='TEST').length,hostedKycConfigured:Boolean(this.hostedKyc&&this.allowedHostedOrigins.length),hostedKycVerifierConfigured:Boolean(this.verifier),providerSubmissionConfigured:false,providerActivationConfigured:false,productionIssuingEnabled:false} as const}
}
