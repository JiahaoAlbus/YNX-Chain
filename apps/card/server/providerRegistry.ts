import {CardError,subject,type Principal} from './contracts.ts';
import {CardStore} from './storage.ts';

export type CardProvider='immersve'|'lithic';
export type ProviderEnvironment='TEST'|'LIVE';
export type ProviderBindingStatus='PLANNED'|'ACCOUNT_REFERENCE_UNVERIFIED'|'ACCOUNT_READBACK_VERIFIED'|'EXTERNAL_REFERENCE_UNVERIFIED'|'LEGACY_READ_ONLY'|'DEGRADED';
export type FundingUnit=
  |{kind:'YNXT_TESTNET';assetId:'YNXT';appChain:'ynx_6423-1';fundingNetwork:string;tokenContract:string|null;decimals:number;manifestHash:string}
  |{kind:'TUSD_TESTNET';assetId:'tUSD';appChain:'ynx_6423-1';fundingNetwork:string;tokenContract:string;decimals:number;manifestHash:string}
  |{kind:'PROVIDER_TEST_ASSET';assetId:string;provider:CardProvider;programId:string;environment:'TEST';fundingNetwork:string;tokenContract:string|null;decimals:number;manifestHash:string}
  |{kind:'CARD_ACCOUNT';currency:string;provider:CardProvider;programId:string;environment:ProviderEnvironment;minorUnitDigits:number;manifestHash:string};
export type ProviderBinding={productCardId:string;provider:CardProvider;programId:string;environment:ProviderEnvironment;status:ProviderBindingStatus;externalAccountId:string|null;externalCardId:string|null;externalFundingSourceId:string|null;sourceAsOf:string|null;accountBindingEvidenceId:string|null;accountReadbackAsOf:string|null;bindingEvidenceId:string|null;createdAt:string;updatedAt:string};
export type ProviderActivity={sequence:number;productCardId:string;provider:CardProvider;programId:string;environment:ProviderEnvironment;externalEventId:string;type:'AUTHORIZATION'|'CAPTURE'|'REVERSAL'|'REFUND'|'DISPUTE'|'FUNDING'|'STATUS';status:string;amount:string|null;unit:FundingUnit|null;occurredAt:string;recordedAt:string;sourceAsOf:string;source:'PROVIDER_TEST'|'PROVIDER_LIVE';spendableBalanceCreated:false};
export type ProviderReadConnector={provider:CardProvider;programId:string;environment:'TEST';getCardStatus(accountId:string,cardId:string):Promise<{externalCardId:string;status:string;sourceAsOf:string;[key:string]:unknown}>};
export type ProviderAccountReadConnector={provider:CardProvider;programId:string;environment:'TEST';getAccountStatus(accountId:string):Promise<{externalAccountId:string;status:string;sourceAsOf:string;[key:string]:unknown}>};
type State={bindings:Record<string,ProviderBinding>;events:ProviderActivity[];nextSequence:number};
const empty=():State=>({bindings:{},events:[],nextSequence:1});
const id=(value:unknown,name:string)=>{if(typeof value!=='string'||! /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))throw new CardError('INVALID_'+name,400);return value};
const iso=(value:unknown,name:string)=>{if(typeof value!=='string'||! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw new CardError('INVALID_'+name,400);return value};
const provider=(value:unknown):CardProvider=>{if(value!=='immersve'&&value!=='lithic')throw new CardError('CARD_PROVIDER_UNSUPPORTED',400);return value};
const environment=(value:unknown):ProviderEnvironment=>{if(value!=='TEST'&&value!=='LIVE')throw new CardError('CARD_PROVIDER_ENVIRONMENT_INVALID',400);return value};
const ownerKey=(owner:string)=>'card-provider-registry:'+owner;
function assertOwner(principal:Principal){try{subject(principal.owner)}catch{throw new CardError('CARD_OWNER_INVALID',400)}}
function assertUnit(unit:FundingUnit,acceptedUnits:readonly FundingUnit[]):FundingUnit{
  if(!/^sha256:[a-f0-9]{64}$/.test(unit.manifestHash))throw new CardError('FUNDING_UNIT_INVALID',400);
  if(unit.kind==='YNXT_TESTNET'||unit.kind==='TUSD_TESTNET'){if(unit.appChain!=='ynx_6423-1'||unit.assetId!==(unit.kind==='YNXT_TESTNET'?'YNXT':'tUSD'))throw new CardError('FUNDING_UNIT_INVALID',400)}
  else if(unit.kind==='PROVIDER_TEST_ASSET'){provider(unit.provider);id(unit.programId,'PROGRAM_ID');id(unit.assetId,'ASSET_ID');if(unit.environment!=='TEST')throw new CardError('FUNDING_UNIT_INVALID',400)}
  else if(unit.kind==='CARD_ACCOUNT'){provider(unit.provider);id(unit.programId,'PROGRAM_ID');environment(unit.environment);if(!/^[A-Z]{3}$/.test(unit.currency)||!Number.isInteger(unit.minorUnitDigits)||unit.minorUnitDigits<0||unit.minorUnitDigits>9)throw new CardError('FUNDING_UNIT_INVALID',400)}
  else throw new CardError('FUNDING_UNIT_INVALID',400);
  if(unit.kind!=='CARD_ACCOUNT'){
    if(!/^[a-z0-9][a-z0-9:._-]{0,80}$/.test(unit.fundingNetwork)||!Number.isInteger(unit.decimals)||unit.decimals<0||unit.decimals>30||unit.tokenContract!==null&&!/^0x[0-9a-fA-F]{40}$/.test(unit.tokenContract))throw new CardError('FUNDING_UNIT_INVALID',400);
    if(unit.kind==='TUSD_TESTNET'&&unit.tokenContract===null)throw new CardError('FUNDING_UNIT_INVALID',400);
  }
  const canonical=(value:FundingUnit)=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));
  if(!acceptedUnits.some(accepted=>canonical(accepted)===canonical(unit)))throw new CardError('FUNDING_UNIT_UNCONFIGURED',503);
  return structuredClone(unit);
}

/** Owner-scoped routing metadata, not an issuing or balance authority. Provider
 * writes are deliberately absent. Existing YNXT ledger state is never read here. */
export class CardProviderRegistry{
  constructor(private readonly store:CardStore,private readonly acceptedUnits:readonly FundingUnit[]=[]){}
  plan(principal:Principal,input:{productCardId:string;provider:CardProvider;programId:string;environment:ProviderEnvironment},now=new Date().toISOString()):ProviderBinding{
    assertOwner(principal);const productCardId=id(input.productCardId,'PRODUCT_CARD_ID'),selected=provider(input.provider),programId=id(input.programId,'PROGRAM_ID'),env=environment(input.environment);iso(now,'TIMESTAMP');
    if(env!=='TEST')throw new CardError('LIVE_PROVIDER_BINDING_NOT_AUTHORIZED',403);
    return this.store.transaction(ownerKey(principal.owner),empty,state=>{
      const prior=state.bindings[productCardId];if(prior){if(prior.provider!==selected||prior.programId!==programId||prior.environment!==env)throw new CardError('CARD_PROVIDER_BINDING_IMMUTABLE');return prior}
      const binding:ProviderBinding={productCardId,provider:selected,programId,environment:env,status:'PLANNED',externalAccountId:null,externalCardId:null,externalFundingSourceId:null,sourceAsOf:null,accountBindingEvidenceId:null,accountReadbackAsOf:null,bindingEvidenceId:null,createdAt:now,updatedAt:now};
      state.bindings[productCardId]=binding;return binding;
    });
  }
  recordAccountReference(principal:Principal,productCardId:string,input:{externalAccountId:string;sourceAsOf:string;evidenceId:string},now=new Date().toISOString()):ProviderBinding{
    assertOwner(principal);id(productCardId,'PRODUCT_CARD_ID');const account=id(input.externalAccountId,'EXTERNAL_ACCOUNT_ID'),evidence=id(input.evidenceId,'EVIDENCE_ID');iso(input.sourceAsOf,'SOURCE_TIME');iso(now,'TIMESTAMP');
    return this.store.transaction(ownerKey(principal.owner),empty,state=>{const binding=state.bindings[productCardId];if(!binding)throw new CardError('CARD_PROVIDER_BINDING_NOT_FOUND',404);if(binding.environment!=='TEST'||binding.status==='LEGACY_READ_ONLY')throw new CardError('PROVIDER_ACCOUNT_BINDING_FORBIDDEN',403);
      if(binding.externalAccountId){if(binding.externalAccountId!==account||binding.accountBindingEvidenceId!==evidence)throw new CardError('PROVIDER_ACCOUNT_BINDING_CONFLICT');return binding}
      this.store.claim('card-provider:'+binding.provider+':'+binding.environment+':'+binding.programId+':account',account,principal.owner,productCardId);
      binding.externalAccountId=account;binding.accountBindingEvidenceId=evidence;binding.sourceAsOf=input.sourceAsOf;binding.status='ACCOUNT_REFERENCE_UNVERIFIED';binding.updatedAt=now;return binding;
    });
  }
  async verifyAccountReadback(principal:Principal,productCardId:string,connectors:readonly ProviderAccountReadConnector[],now=new Date().toISOString()):Promise<ProviderBinding>{
    const binding=this.resolve(principal,productCardId);iso(now,'TIMESTAMP');if(binding.environment!=='TEST'||!binding.externalAccountId||!['ACCOUNT_REFERENCE_UNVERIFIED','ACCOUNT_READBACK_VERIFIED'].includes(binding.status))throw new CardError('PROVIDER_ACCOUNT_READ_UNAVAILABLE',503);
    const matches=connectors.filter(connector=>connector.provider===binding.provider&&connector.programId===binding.programId&&connector.environment===binding.environment);if(matches.length!==1)throw new CardError('PROVIDER_ACCOUNT_READ_UNAVAILABLE',503);
    let response:Awaited<ReturnType<ProviderAccountReadConnector['getAccountStatus']>>;try{response=await matches[0]!.getAccountStatus(binding.externalAccountId)}catch{throw new CardError('PROVIDER_ACCOUNT_READ_DEGRADED',503)}
    if(!response||response.externalAccountId!==binding.externalAccountId)throw new CardError('PROVIDER_ACCOUNT_READ_MISMATCH',409);id(response.status,'PROVIDER_ACCOUNT_STATUS');iso(response.sourceAsOf,'SOURCE_TIME');
    return this.store.transaction(ownerKey(principal.owner),empty,state=>{const current=state.bindings[productCardId];if(!current||current.externalAccountId!==binding.externalAccountId||current.programId!==binding.programId||current.status==='LEGACY_READ_ONLY')throw new CardError('PROVIDER_ACCOUNT_READ_MISMATCH',409);if(current.accountReadbackAsOf&&Date.parse(response.sourceAsOf)<Date.parse(current.accountReadbackAsOf))throw new CardError('PROVIDER_ACCOUNT_READ_STALE',409);current.accountReadbackAsOf=response.sourceAsOf;current.status='ACCOUNT_READBACK_VERIFIED';current.updatedAt=now;return current});
  }
  /** Server-side reference only, after a provider read confirms this account's
   * funding source. The issuer still rechecks ownership before submission. */
  bindTestFundingSource(principal:Principal,productCardId:string,externalFundingSourceId:string,now=new Date().toISOString()):ProviderBinding{
    assertOwner(principal);id(productCardId,'PRODUCT_CARD_ID');const funding=id(externalFundingSourceId,'EXTERNAL_FUNDING_ID');iso(now,'TIMESTAMP');
    return this.store.transaction(ownerKey(principal.owner),empty,state=>{const binding=state.bindings[productCardId];if(!binding||binding.environment!=='TEST'||binding.status!=='ACCOUNT_READBACK_VERIFIED'||!binding.externalAccountId)throw new CardError('PROVIDER_ACCOUNT_NOT_VERIFIED',409);
      if(binding.externalFundingSourceId&&binding.externalFundingSourceId!==funding)throw new CardError('PROVIDER_FUNDING_SOURCE_CONFLICT',409);
      this.store.claim('card-provider:'+binding.provider+':TEST:'+binding.programId+':funding',funding,principal.owner,productCardId);binding.externalFundingSourceId=funding;binding.updatedAt=now;return binding});
  }
  /** Records a proposed Test reference, NOT proof of provider acceptance.
   * Verification needs an entitled provider read and separate Wallet consent. */
  recordSandboxReceipt(principal:Principal,productCardId:string,input:{externalAccountId:string;externalCardId:string;externalFundingSourceId?:string;sourceAsOf:string;evidenceId:string},now=new Date().toISOString()):ProviderBinding{
    assertOwner(principal);id(productCardId,'PRODUCT_CARD_ID');const account=id(input.externalAccountId,'EXTERNAL_ACCOUNT_ID'),card=id(input.externalCardId,'EXTERNAL_CARD_ID'),funding=input.externalFundingSourceId?id(input.externalFundingSourceId,'EXTERNAL_FUNDING_ID'):null,evidence=id(input.evidenceId,'EVIDENCE_ID');iso(input.sourceAsOf,'SOURCE_TIME');iso(now,'TIMESTAMP');
    return this.store.transaction(ownerKey(principal.owner),empty,state=>{
      const binding=state.bindings[productCardId];if(!binding)throw new CardError('CARD_PROVIDER_BINDING_NOT_FOUND',404);if(binding.environment!=='TEST')throw new CardError('LIVE_PROVIDER_BINDING_NOT_AUTHORIZED',403);
      if(binding.status==='LEGACY_READ_ONLY')throw new CardError('LEGACY_PROVIDER_WRITE_FORBIDDEN',403);
      if(binding.externalAccountId&&binding.externalAccountId!==account)throw new CardError('PROVIDER_ACCOUNT_BINDING_CONFLICT');
      if(binding.bindingEvidenceId){if(binding.bindingEvidenceId!==evidence||binding.externalAccountId!==account||binding.externalCardId!==card||binding.externalFundingSourceId!==funding)throw new CardError('PROVIDER_RECEIPT_CONFLICT');return binding}
      for(const [kind,external] of [['account',account],['card',card],...(funding?[['funding',funding]]:[])] as [string,string][])this.store.claim('card-provider:'+binding.provider+':'+binding.environment+':'+binding.programId+':'+kind,external,principal.owner,productCardId);
      Object.assign(binding,{externalAccountId:account,externalCardId:card,externalFundingSourceId:funding,sourceAsOf:input.sourceAsOf,bindingEvidenceId:evidence,status:'EXTERNAL_REFERENCE_UNVERIFIED' as const,updatedAt:now});return binding;
    });
  }
  markLegacy(principal:Principal,productCardId:string,now=new Date().toISOString()):ProviderBinding{
    assertOwner(principal);id(productCardId,'PRODUCT_CARD_ID');iso(now,'TIMESTAMP');return this.store.transaction(ownerKey(principal.owner),empty,state=>{const binding=state.bindings[productCardId];if(!binding)throw new CardError('CARD_PROVIDER_BINDING_NOT_FOUND',404);binding.status='LEGACY_READ_ONLY';binding.updatedAt=now;return binding});
  }
  resolve(principal:Principal,productCardId:string):ProviderBinding{
    assertOwner(principal);id(productCardId,'PRODUCT_CARD_ID');const binding=this.store.read(ownerKey(principal.owner),empty).bindings[productCardId];if(!binding)throw new CardError('CARD_PROVIDER_BINDING_NOT_FOUND',404);return structuredClone(binding);
  }
  async readRoutedStatus(principal:Principal,productCardId:string,connectors:readonly ProviderReadConnector[]) {
    const binding=this.resolve(principal,productCardId);if(binding.environment!=='TEST'||!binding.externalAccountId||!binding.externalCardId)throw new CardError('CARD_PROVIDER_READ_UNAVAILABLE',503);
    const matches=connectors.filter(connector=>connector.provider===binding.provider&&connector.programId===binding.programId&&connector.environment===binding.environment);
    if(matches.length!==1)throw new CardError('CARD_PROVIDER_READ_UNAVAILABLE',503);const connector=matches[0]!;
    let response:Awaited<ReturnType<ProviderReadConnector['getCardStatus']>>;try{response=await connector.getCardStatus(binding.externalAccountId,binding.externalCardId)}catch{throw new CardError('CARD_PROVIDER_READ_DEGRADED',503)}
    if(!response||response.externalCardId!==binding.externalCardId)throw new CardError('CARD_PROVIDER_READ_MISMATCH',409);
    return {productCardId,provider:binding.provider,programId:binding.programId,environment:binding.environment,externalCardId:binding.externalCardId,status:id(response.status,'PROVIDER_STATUS'),sourceAsOf:iso(response.sourceAsOf,'SOURCE_TIME'),spendableBalance:null,realIssuedCard:false,productionRealPayments:false} as const;
  }
  recordEvent(principal:Principal,productCardId:string,input:{externalEventId:string;type:ProviderActivity['type'];status:string;amount?:string;unit?:FundingUnit;occurredAt:string;sourceAsOf:string},now=new Date().toISOString()):ProviderActivity{
    assertOwner(principal);id(productCardId,'PRODUCT_CARD_ID');const eventId=id(input.externalEventId,'EXTERNAL_EVENT_ID'),status=id(input.status,'EVENT_STATUS');if(!['AUTHORIZATION','CAPTURE','REVERSAL','REFUND','DISPUTE','FUNDING','STATUS'].includes(input.type))throw new CardError('PROVIDER_EVENT_TYPE_INVALID',400);iso(input.occurredAt,'EVENT_TIME');iso(input.sourceAsOf,'SOURCE_TIME');iso(now,'TIMESTAMP');
    const amount=input.amount??null,unit=input.unit?assertUnit(input.unit,this.acceptedUnits):null;if((amount===null)!==(unit===null)||amount!==null&&!/^(0|[1-9][0-9]{0,38})$/.test(amount))throw new CardError('PROVIDER_EVENT_AMOUNT_INVALID',400);
    return this.store.transaction(ownerKey(principal.owner),empty,state=>{
      const binding=state.bindings[productCardId];if(!binding||!binding.externalCardId)throw new CardError('CARD_PROVIDER_RECEIPT_REQUIRED',409);
      if(unit&&(unit.kind==='YNXT_TESTNET'||unit.kind==='TUSD_TESTNET'))throw new CardError('PROVIDER_EVENT_UNIT_MISMATCH',400);
      if(unit&&(unit.kind==='PROVIDER_TEST_ASSET'||unit.kind==='CARD_ACCOUNT')){if(unit.provider!==binding.provider||unit.programId!==binding.programId||unit.environment!==binding.environment)throw new CardError('PROVIDER_EVENT_UNIT_MISMATCH',400)}
      const prior=state.events.find(event=>event.provider===binding.provider&&event.programId===binding.programId&&event.environment===binding.environment&&event.externalEventId===eventId);
      if(prior){if(prior.productCardId!==productCardId||prior.type!==input.type||prior.status!==status||prior.amount!==amount||JSON.stringify(prior.unit)!==JSON.stringify(unit)||prior.occurredAt!==input.occurredAt||prior.sourceAsOf!==input.sourceAsOf)throw new CardError('PROVIDER_EVENT_REPLAY_CONFLICT');return prior}
      this.store.claim('card-provider-event:'+binding.provider+':'+binding.environment+':'+binding.programId,eventId,principal.owner,productCardId);
      const event:ProviderActivity={sequence:state.nextSequence++,productCardId,provider:binding.provider,programId:binding.programId,environment:binding.environment,externalEventId:eventId,type:input.type,status,amount,unit,occurredAt:input.occurredAt,recordedAt:now,sourceAsOf:input.sourceAsOf,source:binding.environment==='TEST'?'PROVIDER_TEST':'PROVIDER_LIVE',spendableBalanceCreated:false};state.events.push(event);return event;
    });
  }
  overview(principal:Principal){assertOwner(principal);const state=this.store.read(ownerKey(principal.owner),empty);return {schemaVersion:2,owner:principal.owner,cards:Object.values(state.bindings).map(binding=>({...binding,spendableBalance:null,realIssuedCard:false})),assetAggregation:'FORBIDDEN',productionRealPayments:false} as const}
  activity(principal:Principal,productCardId:string,cursor=0,limit=50){this.resolve(principal,productCardId);if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new CardError('INVALID_ACTIVITY_PAGE',400);const state=this.store.read(ownerKey(principal.owner),empty),events=state.events.filter(event=>event.productCardId===productCardId&&event.sequence>cursor).sort((a,b)=>a.sequence-b.sequence),items=events.slice(0,limit);return {schemaVersion:2,productCardId,items,nextCursor:events.length>limit?items.at(-1)!.sequence:null,source:'PROVIDER_METADATA_ONLY',spendableBalance:null,productionRealPayments:false} as const}
  doctor(){return {schemaVersion:2,providers:['immersve','lithic'],environment:'TEST',acceptedFundingUnits:this.acceptedUnits.length,providerWritesEnabled:false,liveIssuingEnabled:false,realCardDataStored:false,ynxtBalanceAuthority:false} as const}
}
