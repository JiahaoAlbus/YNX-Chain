import {createHash,randomUUID} from 'node:crypto';
import {CardError,type Principal} from './contracts.ts';
import {CardStore} from './storage.ts';
import {CardProviderApplications,type ProviderProgramTerms} from './providerApplication.ts';
import {CardProviderRegistry} from './providerRegistry.ts';
import {ImmersveSandbox} from './immersveSandbox.ts';
import {cardApplicationApprovalId,cardProviderDetailsHash,createCardApplicationApprovalRequest,parseCardApplicationApprovalReturnURL,type CardApplicationApprovalRequest,type CardProviderDetails} from '@ynx-chain/wallet-auth-card-provider-v2';

type Operation={id:string;kind:'CREATE'|'FREEZE'|'UNFREEZE';applicationId:string;productCardId:string;fingerprint:string;status:'UNKNOWN'|'RESPONSE_RECORDED'|'READBACK_CONFIRMED';externalCardId:string|null;outcome:string;createdAt:string;updatedAt:string};
export type ProviderTransactionRead={id:string;productCardId:string;provider:'immersve';programId:string;environment:'TEST';externalCardId:string;status:string;paymentType:string;creditDebitIndicator:string|null;amountMinor:string|null;feeMinor:string|null;currency:string|null;minorUnitDigits:number|null;occurredAt:string|null;processedAt:string|null;relatedPaymentId:string|null;sourceAsOf:string|null;reconciliation:'PROVIDER_READBACK_MATCHED'|'PROVIDER_READBACK_PENDING';spendableBalanceCreated:false};
type AcceptedApproval={approvalId:string;detailsHash:string;expiresAt:string};
type State={approvalRequests:Record<string,CardApplicationApprovalRequest>;acceptedApprovals?:Record<string,AcceptedApproval>;createByApplication?:Record<string,string>;operations:Record<string,Operation>;transactions?:Record<string,ProviderTransactionRead>};
const empty=():State=>({approvalRequests:{},acceptedApprovals:{},createByApplication:{},operations:{},transactions:{}});
const key=(owner:string)=>'card-provider-lifecycle:'+owner;
const id=(value:string)=>{if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw new CardError('INVALID_PROVIDER_REFERENCE',400);return value};
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type IssuingProgram=ProviderProgramTerms&{fundingChannelId:string;fundingNetwork:string;fundingAssetId:string;providerBalanceCurrency:string;tokenContract:string|null;decimals:number;riskVersion:string;riskHash:string;feeDisclosureVersion:string;feeDisclosureText:string};
/** Fail closed on incomplete or mixed TEST funding/disclosure configuration. */
export function parseIssuingPrograms(raw:unknown):IssuingProgram[]{
  if(!Array.isArray(raw)||raw.length>16)throw Error('YNX_CARD_TEST_PROGRAMS_JSON_INVALID');const seen=new Set<string>();
  return raw.map(value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('YNX_CARD_TEST_PROGRAM_INVALID');const p=value as Record<string,unknown>;
    const ref=(name:string)=>{const s=p[name];if(typeof s!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s))throw Error('YNX_CARD_TEST_PROGRAM_'+name.toUpperCase()+'_INVALID');return s};
    const hash=(name:string)=>{const s=p[name];if(typeof s!=='string'||! /^(?:sha256:)?[a-f0-9]{64}$/.test(s))throw Error('YNX_CARD_TEST_PROGRAM_'+name.toUpperCase()+'_INVALID');return s};
    if(p.provider!=='immersve'||p.environment!=='TEST'||typeof p.enabled!=='boolean')throw Error('YNX_CARD_TEST_PROGRAM_IDENTITY_INVALID');
    const programId=ref('programId'),fundingChannelId=ref('fundingChannelId'),termsVersion=ref('termsVersion'),riskVersion=ref('riskVersion'),feeDisclosureVersion=ref('feeDisclosureVersion'),termsHash=hash('termsHash'),riskHash=hash('riskHash'),feeDisclosureHash=hash('feeDisclosureHash');
    if(seen.has(programId))throw Error('YNX_CARD_TEST_PROGRAM_DUPLICATE');seen.add(programId);
    const feeDisclosureText=p.feeDisclosureText;if(typeof feeDisclosureText!=='string'||feeDisclosureText.length<8||feeDisclosureText.length>2048||createHash('sha256').update(feeDisclosureText).digest('hex')!==feeDisclosureHash.replace(/^sha256:/,''))throw Error('YNX_CARD_TEST_FEE_DISCLOSURE_INVALID');
    const cardAccountCurrency=p.cardAccountCurrency;if(typeof cardAccountCurrency!=='string'||! /^[A-Z]{3}$/.test(cardAccountCurrency))throw Error('YNX_CARD_TEST_CURRENCY_INVALID');
    const minorUnitDigits=p.minorUnitDigits,decimals=p.decimals;if(!Number.isInteger(minorUnitDigits)||Number(minorUnitDigits)<0||Number(minorUnitDigits)>9||!Number.isInteger(decimals)||Number(decimals)<0||Number(decimals)>30)throw Error('YNX_CARD_TEST_PRECISION_INVALID');
    const fundingNetwork=p.fundingNetwork;if(typeof fundingNetwork!=='string'||! /^[a-z0-9][a-z0-9:._-]{0,80}$/.test(fundingNetwork))throw Error('YNX_CARD_TEST_NETWORK_INVALID');
    const fundingAssetId=ref('fundingAssetId'),providerBalanceCurrency=ref('providerBalanceCurrency'),tokenContract=p.tokenContract;if(tokenContract!==null&&(typeof tokenContract!=='string'||! /^0x[0-9a-fA-F]{40}$/.test(tokenContract)))throw Error('YNX_CARD_TEST_TOKEN_CONTRACT_INVALID');
    return {provider:'immersve' as const,programId,environment:'TEST' as const,enabled:p.enabled,fundingChannelId,termsVersion,termsHash,riskVersion,riskHash,feeDisclosureVersion,feeDisclosureText,feeDisclosureHash,cardAccountCurrency,minorUnitDigits:Number(minorUnitDigits),fundingNetwork,fundingAssetId,providerBalanceCurrency,tokenContract,decimals:Number(decimals)};
  });
}

/** One TEST provider. All mutations reserve UNKNOWN durably before transport;
 * the provider has not documented idempotency, so an uncertain request is never resent. */
export class CardProviderLifecycle {
  constructor(private readonly store:CardStore,private readonly applications:CardProviderApplications,private readonly registry:CardProviderRegistry,private readonly immersve:ImmersveSandbox,private readonly walletRegistry:unknown,private readonly programs:readonly IssuingProgram[],private readonly writeEnabled=false){}
  private context(principal:Principal,applicationId:string){
    const app=this.applications.get(principal,id(applicationId));const binding=this.registry.resolve(principal,app.productCardId);
    if(app.owner!==principal.owner||app.provider!=='immersve'||binding.provider!==app.provider||binding.programId!==app.programId||binding.environment!=='TEST'||binding.externalAccountId===null||binding.status!=='ACCOUNT_READBACK_VERIFIED'&&binding.status!=='EXTERNAL_REFERENCE_UNVERIFIED')throw new CardError('PROVIDER_ACCOUNT_NOT_VERIFIED',409);
    const program=this.programs.find(p=>p.provider==='immersve'&&p.programId===app.programId&&p.environment==='TEST');
    return {app,binding,program,accountId:binding.externalAccountId};
  }
  private assertWrite(principal:Principal,scope:string){if(!this.writeEnabled)throw new CardError('PROVIDER_TEST_WRITE_DISABLED',503);if(!principal.scopes.includes(scope as never))throw new CardError('CARD_PERMISSION_DENIED',403);if(Date.parse(principal.expiresAt)<=Date.now())throw new CardError('CARD_AUTH_EXPIRED',401)}
  /** Trusted account-linking seam, never mounted as a browser route. */
  async bindExistingAccount(principal:Principal,applicationId:string,externalAccountId:string,evidenceId:string){
    const app=this.applications.get(principal,applicationId);if(app.provider!=='immersve'||app.providerEnvironment!=='TEST')throw new CardError('CARD_PROVIDER_UNSUPPORTED',400);
    this.registry.recordAccountReference(principal,app.productCardId,{externalAccountId:id(externalAccountId),evidenceId:id(evidenceId),sourceAsOf:new Date().toISOString()});
    return this.registry.verifyAccountReadback(principal,app.productCardId,[{provider:'immersve',programId:app.programId,environment:'TEST',getAccountStatus:accountId=>this.immersve.readAccount(accountId)}]);
  }
  async prepareApproval(principal:Principal,applicationId:string,input:{platform:'web'|'ios'|'android';fundingSourceId:string;idempotencyKey:string},now=new Date()){
    this.assertWrite(principal,'card:application:write');const {app,binding,program,accountId}=this.context(principal,applicationId);if(!program?.enabled)throw new CardError('PROVIDER_PROGRAM_NOT_CONFIGURED',503);
    if(app.status!=='APPROVAL_REQUIRED')throw new CardError('PROVIDER_APPLICATION_STATE_CONFLICT',409);
    if(!binding.accountBindingEvidenceId||!binding.accountReadbackAsOf)throw new CardError('PROVIDER_ACCOUNT_NOT_VERIFIED',409);
    const fundingSourceId=id(input.fundingSourceId),sources=await this.immersve.listFundingSourcesForAccount(accountId);
    if(!sources.some(source=>source.id===fundingSourceId&&source.accountId===accountId&&source.fundingChannelId===program.fundingChannelId))throw new CardError('PROVIDER_FUNDING_SOURCE_NOT_OWNED',409);
    if(binding.externalFundingSourceId&&binding.externalFundingSourceId!==fundingSourceId)throw new CardError('PROVIDER_FUNDING_SOURCE_CONFLICT',409);
    if(!binding.externalFundingSourceId)this.registry.bindTestFundingSource(principal,app.productCardId,fundingSourceId);
    const bindingHash=sha({owner:principal.owner,provider:'immersve',programId:app.programId,environment:'TEST',accountId,evidenceId:binding.accountBindingEvidenceId});
    const details:CardProviderDetails={productCardId:app.productCardId,principalOwner:principal.owner,provider:'immersve',programId:app.programId,environment:'TEST',externalAccountBindingHash:bindingHash,appChain:'ynx_6423-1',fundingNetwork:program.fundingNetwork,fundingAssetId:program.fundingAssetId,tokenContract:program.tokenContract,decimals:program.decimals,testSpendingLimitMinor:app.testSpendingLimitMinor,cardAccountCurrency:app.cardAccountCurrency,minorUnitDigits:app.minorUnitDigits,termsVersion:app.termsVersion,termsHash:app.termsHash.replace(/^sha256:/,''),riskVersion:program.riskVersion,riskHash:program.riskHash,feeDisclosureVersion:program.feeDisclosureVersion,feeDisclosureText:program.feeDisclosureText,feeDisclosureHash:app.feeDisclosureHash.replace(/^sha256:/,''),idempotencyKey:id(input.idempotencyKey)};
    const prior=this.store.read(key(principal.owner),empty).approvalRequests[app.id];if(prior&&Date.parse(prior.expiresAt)>now.getTime()){if(sha(prior.details)!==sha(details))throw new CardError('PROVIDER_APPROVAL_CONFLICT',409);return prior}
    const issuedAt=now.toISOString(),expiresAt=new Date(now.getTime()+300000).toISOString();const challenge={id:'challenge_'+randomUUID(),applicationId:app.id,owner:principal.owner,chainId:'0x1917' as const,purpose:'create-provider-test-card' as const,payloadHash:cardProviderDetailsHash(details),nonce:randomUUID(),issuedAt,expiresAt};
    let request:CardApplicationApprovalRequest;try{request=createCardApplicationApprovalRequest(this.walletRegistry,{productId:'card',platform:input.platform,account:principal.owner,challenge,details,requestId:randomUUID(),state:randomUUID().replaceAll('-','')},now)}catch{throw new CardError('PROVIDER_WALLET_APPROVAL_UNAVAILABLE',503)}
    return this.store.transaction(key(principal.owner),empty,state=>{const previous=state.approvalRequests[app.id];if(previous&&Date.parse(previous.expiresAt)>now.getTime()){if(sha(previous.details)!==sha(details))throw new CardError('PROVIDER_APPROVAL_CONFLICT',409);return previous}if(state.createByApplication?.[app.id])throw new CardError('PROVIDER_CREATE_ALREADY_RESERVED',409);state.approvalRequests[app.id]=request;return request});
  }
  acceptApproval(principal:Principal,applicationId:string,resultURL:string,now=new Date()){
    this.assertWrite(principal,'card:application:write');const {app}=this.context(principal,applicationId),request=this.store.read(key(principal.owner),empty).approvalRequests[app.id];if(!request)throw new CardError('PROVIDER_APPROVAL_REQUEST_MISSING',409);
    let result:ReturnType<typeof parseCardApplicationApprovalReturnURL>;try{result=parseCardApplicationApprovalReturnURL(this.walletRegistry,resultURL,request,now)}catch{throw new CardError('INVALID_CARD_APPROVAL',403)}
    if(result.status!=='approved')throw new CardError('CARD_APPROVAL_REJECTED',403);
    const approvalId=cardApplicationApprovalId(result.approval);const application=this.applications.recordProviderApproval(principal,app.id,approvalId,now.toISOString());
    this.store.transaction(key(principal.owner),empty,state=>{const current=state.approvalRequests[app.id];if(!current||sha(current)!==sha(request))throw new CardError('PROVIDER_APPROVAL_REQUEST_CHANGED',409);state.acceptedApprovals??={};const prior=state.acceptedApprovals[app.id];if(prior&&prior.approvalId!==approvalId)throw new CardError('PROVIDER_APPROVAL_CONFLICT',409);state.acceptedApprovals[app.id]={approvalId,detailsHash:sha(request.details),expiresAt:result.approval.expiresAt};return null});return application;
  }
  private reserve(principal:Principal,operationId:string,kind:Operation['kind'],applicationId:string,productCardId:string,fingerprint:string){
    return this.store.transaction(key(principal.owner),empty,state=>{const existingCreate=kind==='CREATE'?state.createByApplication?.[applicationId]:undefined;if(existingCreate&&existingCreate!==operationId)throw new CardError('PROVIDER_CREATE_ALREADY_RESERVED',409);const prior=state.operations[id(operationId)];if(prior){if(prior.fingerprint!==fingerprint||prior.kind!==kind||prior.applicationId!==applicationId)throw new CardError('PROVIDER_OPERATION_CONFLICT',409);return {fresh:false,operation:prior}}
      if(kind==='CREATE'){const accepted=state.acceptedApprovals?.[applicationId],request=state.approvalRequests[applicationId];if(!accepted||!request||Date.parse(accepted.expiresAt)<=Date.now()||accepted.detailsHash!==sha(request.details)||(request.details as CardProviderDetails).idempotencyKey!==operationId)throw new CardError('PROVIDER_APPROVAL_EXPIRED_OR_CHANGED',409)}
      if(Object.keys(state.operations).length>=10)throw new CardError('PROVIDER_TEST_OPERATION_CAP',429);const at=new Date().toISOString(),operation:Operation={id:operationId,kind,applicationId,productCardId,fingerprint,status:'UNKNOWN',externalCardId:null,outcome:'ATTEMPT_RESERVED',createdAt:at,updatedAt:at};state.operations[operationId]=operation;if(kind==='CREATE'){state.createByApplication??={};state.createByApplication[applicationId]=operationId}return {fresh:true,operation}});
  }
  private update(principal:Principal,operationId:string,patch:Partial<Operation>){return this.store.transaction(key(principal.owner),empty,state=>{const op=state.operations[operationId];if(!op)throw new CardError('PROVIDER_OPERATION_NOT_FOUND',404);Object.assign(op,patch,{updatedAt:new Date().toISOString()});return op})}
  operation(principal:Principal,operationId:string){const op=this.store.read(key(principal.owner),empty).operations[id(operationId)];if(!op)throw new CardError('PROVIDER_OPERATION_NOT_FOUND',404);return op}
  async submit(principal:Principal,applicationId:string,operationId:string){
    this.assertWrite(principal,'card:application:write');const {app,binding,accountId,program}=this.context(principal,applicationId),state=this.store.read(key(principal.owner),empty);const prior=state.operations[id(operationId)];if(prior){if(prior.kind!=='CREATE'||prior.applicationId!==app.id)throw new CardError('PROVIDER_OPERATION_CONFLICT',409);return prior}if(state.createByApplication?.[app.id])throw new CardError('PROVIDER_CREATE_ALREADY_RESERVED',409);if(!program?.enabled)throw new CardError('PROVIDER_PROGRAM_NOT_CONFIGURED',503);if(!app.walletApprovalVerified||app.status!=='APPROVAL_REQUIRED')throw new CardError('PROVIDER_APPROVAL_REQUIRED',409);
    const request=state.approvalRequests[app.id],accepted=state.acceptedApprovals?.[app.id];if(!request||request.version!=='2'||!accepted)throw new CardError('PROVIDER_APPROVAL_REQUEST_MISSING',409);
    if(Date.parse(accepted.expiresAt)<=Date.now()||accepted.detailsHash!==sha(request.details)||request.challenge.purpose!=='create-provider-test-card')throw new CardError('PROVIDER_APPROVAL_EXPIRED_OR_CHANGED',409);
    const details=request.details as CardProviderDetails;const bindingHash=sha({owner:principal.owner,provider:'immersve',programId:app.programId,environment:'TEST',accountId,evidenceId:binding.accountBindingEvidenceId});
    if(operationId!==details.idempotencyKey)throw new CardError('PROVIDER_OPERATION_APPROVAL_MISMATCH',409);
    if(details.productCardId!==app.productCardId||details.principalOwner!==principal.owner||details.provider!=='immersve'||details.programId!==app.programId||details.environment!=='TEST'||details.externalAccountBindingHash!==bindingHash||details.testSpendingLimitMinor!==app.testSpendingLimitMinor||details.cardAccountCurrency!==app.cardAccountCurrency||details.minorUnitDigits!==app.minorUnitDigits||details.termsVersion!==app.termsVersion||details.termsHash!==app.termsHash.replace(/^sha256:/,'')||details.feeDisclosureHash!==app.feeDisclosureHash.replace(/^sha256:/,''))throw new CardError('PROVIDER_APPROVAL_BINDING_CHANGED',409);
    // The funding source is a trusted registry reference, never inferred from
    // an approval idempotency key or a browser-selected address.
    if(!binding.externalFundingSourceId)throw new CardError('PROVIDER_FUNDING_SOURCE_UNBOUND',409);
    const source=await this.immersve.listFundingSourcesForAccount(accountId);if(!source.some(item=>item.id===binding.externalFundingSourceId&&item.accountId===accountId&&item.fundingChannelId===program.fundingChannelId))throw new CardError('PROVIDER_FUNDING_SOURCE_NOT_OWNED',409);
    const fingerprint=sha({applicationId:app.id,accountId,programId:app.programId,fundingSourceId:binding.externalFundingSourceId});const reserved=this.reserve(principal,operationId,'CREATE',app.id,app.productCardId,fingerprint);if(!reserved.fresh)return reserved.operation;
    try{const cardId=await this.immersve.submitCard(accountId,app.programId,binding.externalFundingSourceId);this.applications.recordProviderSubmission(principal,app.id,cardId);this.registry.recordSandboxReceipt(principal,app.productCardId,{externalAccountId:accountId,externalCardId:cardId,externalFundingSourceId:binding.externalFundingSourceId,sourceAsOf:new Date().toISOString(),evidenceId:operationId});return this.update(principal,operationId,{status:'RESPONSE_RECORDED',externalCardId:cardId,outcome:'CARD_ID_RECORDED'});
    }catch{return this.update(principal,operationId,{outcome:'PROVIDER_OUTCOME_UNKNOWN'})}
  }
  async readStatus(principal:Principal,applicationId:string){const {app,binding,accountId}=this.context(principal,applicationId);if(!app.upstreamCardId||binding.externalCardId!==app.upstreamCardId)throw new CardError('PROVIDER_CARD_UNBOUND',409);
    const card=await this.immersve.readCard(accountId,app.upstreamCardId);if(card.cardProgramId!==app.programId||!binding.externalFundingSourceId||!card.fundingSourceIds.includes(binding.externalFundingSourceId))throw new CardError('PROVIDER_CARD_READBACK_MISMATCH',409);
    const application=this.applications.recordProviderReadback(principal,app.id,card.cardId,card.status);return {application,card};
  }
  async control(principal:Principal,applicationId:string,operationId:string,kind:'FREEZE'|'UNFREEZE'){
    this.assertWrite(principal,'card:controls:write');const {app,accountId}=this.context(principal,applicationId);const prior=this.store.read(key(principal.owner),empty).operations[id(operationId)];if(prior){if(prior.kind!==kind||prior.applicationId!==app.id)throw new CardError('PROVIDER_OPERATION_CONFLICT',409);return prior}if(app.status!=='ACTIVE_SANDBOX'||!app.upstreamCardId)throw new CardError('PROVIDER_CARD_NOT_ACTIVE',409);
    const before=await this.readStatus(principal,applicationId),expectedBlocked=kind==='FREEZE';if(before.card.status!=='active'||before.card.isBlocked===null||before.card.isBlocked===expectedBlocked)throw new CardError('PROVIDER_CONTROL_STATE_CONFLICT',409);
    const fingerprint=sha({applicationId,cardId:app.upstreamCardId,kind});const reserved=this.reserve(principal,operationId,kind,app.id,app.productCardId,fingerprint);if(!reserved.fresh)return reserved.operation;
    try{await this.immersve.setCardFrozen(accountId,app.upstreamCardId,expectedBlocked);this.update(principal,operationId,{status:'RESPONSE_RECORDED',outcome:'PROVIDER_RESPONSE_RECORDED'});const after=await this.immersve.readCard(accountId,app.upstreamCardId);if(after.status!=='active'||after.isBlocked!==expectedBlocked)return this.operation(principal,operationId);return this.update(principal,operationId,{status:'READBACK_CONFIRMED',outcome:'PROVIDER_STATUS_CONFIRMED'});
    }catch{return this.update(principal,operationId,{outcome:'PROVIDER_OUTCOME_UNKNOWN'})}
  }
  async unknownCreateCandidates(principal:Principal,applicationId:string){const {app,accountId,binding}=this.context(principal,applicationId),page=await this.immersve.listAccountCards(accountId);return {applicationId:app.id,items:page.items.filter(item=>item.cardProgramId===app.programId&&binding.externalFundingSourceId&&item.fundingSourceIds.includes(binding.externalFundingSourceId)).map(item=>({...item,attribution:'UNVERIFIED'})),nextCursor:page.nextCursor,automaticResubmit:false}}
  async readFunding(principal:Principal,applicationId:string){const {app,binding,accountId,program}=this.context(principal,applicationId);if(!program||!binding.externalFundingSourceId)throw new CardError('PROVIDER_FUNDING_SOURCE_UNBOUND',409);
    const sources=await this.immersve.listFundingSourcesForAccount(accountId),source=sources.find(item=>item.id===binding.externalFundingSourceId&&item.accountId===accountId&&item.fundingChannelId===program.fundingChannelId);if(!source||source.balanceCurrency!==program.providerBalanceCurrency)throw new CardError('PROVIDER_FUNDING_SOURCE_MISMATCH',409);
    return {productCardId:app.productCardId,provider:'immersve',programId:app.programId,environment:'TEST',fundingSourceId:source.id,balanceMinor:source.balanceMinor,balanceCurrency:source.balanceCurrency,fundingAssetId:program.fundingAssetId,fundingNetwork:program.fundingNetwork,decimals:program.decimals,observedAt:new Date().toISOString(),sourceAsOf:null,spendableCardBalance:null,balanceAuthority:'IMMERSVE_TEST_FUNDING_SOURCE'};
  }
  private transaction(item:Record<string,unknown>,accountId:string,cardId:string,productCardId:string,programId:string,cardCurrency:string,cardDigits:number):ProviderTransactionRead{
    if(item.accountId!==accountId||item.cardId!==cardId)throw new CardError('PROVIDER_TRANSACTION_BINDING_MISMATCH',409);
    const transactionId=id(String(item.id??''));const status=id(String(item.status??''));const paymentType=typeof item.paymentType==='string'?id(item.paymentType):'UNCLASSIFIED';
    const amountMinor=typeof item.amount==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(item.amount)?item.amount:null;
    const feeMinor=typeof item.feeAmount==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(item.feeAmount)?item.feeAmount:null;
    const currency=typeof item.currency==='string'&&/^[A-Z]{3}$/.test(item.currency)?item.currency:null;
    const occurredAt=typeof item.transactionDate==='string'&&Number.isFinite(Date.parse(item.transactionDate))?item.transactionDate:null;
    const processedAt=typeof item.processedDate==='string'&&Number.isFinite(Date.parse(item.processedDate))?item.processedDate:null;
    const sourceAsOf=processedAt??occurredAt;
    const creditDebitIndicator=item.creditDebitIndicator==='credit'||item.creditDebitIndicator==='debit'?item.creditDebitIndicator:null;
    const relatedPaymentId=typeof item.relatedPaymentId==='string'?id(item.relatedPaymentId):null;
    return {id:transactionId,productCardId,provider:'immersve',programId,environment:'TEST',externalCardId:cardId,status,paymentType,creditDebitIndicator,amountMinor,feeMinor,currency,minorUnitDigits:currency===cardCurrency?cardDigits:null,occurredAt,processedAt,relatedPaymentId,sourceAsOf,reconciliation:'PROVIDER_READBACK_PENDING',spendableBalanceCreated:false};
  }
  async history(principal:Principal,applicationId:string,cursor?:string){const {app,accountId}=this.context(principal,applicationId);if(!app.upstreamCardId)throw new CardError('PROVIDER_CARD_UNBOUND',409);
    const page=await this.immersve.listAccountTransactions(accountId,cursor),items=page.items.filter(item=>item.cardId===app.upstreamCardId).map(item=>this.transaction(item,accountId,app.upstreamCardId!,app.productCardId,app.programId,app.cardAccountCurrency,app.minorUnitDigits));
    const readbacks=await Promise.all(items.map(async item=>{try{const detail=await this.immersve.readTransaction(accountId,item.id);const current=this.transaction(detail,accountId,item.externalCardId,item.productCardId,item.programId,app.cardAccountCurrency,app.minorUnitDigits);return {...item,reconciliation:item.sourceAsOf!==null&&sha(item)===sha(current)?'PROVIDER_READBACK_MATCHED' as const:'PROVIDER_READBACK_PENDING' as const}}catch{return item}}));
    this.store.transaction(key(principal.owner),empty,state=>{state.transactions??={};for(const item of readbacks){const prior=state.transactions[item.id];if(prior&&(prior.productCardId!==item.productCardId||prior.programId!==item.programId||prior.externalCardId!==item.externalCardId))throw new CardError('PROVIDER_TRANSACTION_CONFLICT',409);if(!prior||item.sourceAsOf&&(!prior.sourceAsOf||Date.parse(item.sourceAsOf)>=Date.parse(prior.sourceAsOf)))state.transactions[item.id]=item}return null});
    return {items:readbacks,nextCursor:page.nextCursor,source:'IMMERSVE_TEST_READBACK',reconciliation:'NO_LOCAL_BALANCE_AUTHORITY',spendableBalance:null};
  }
  recordedHistory(principal:Principal){return Object.values(this.store.read(key(principal.owner),empty).transactions??{}).sort((a,b)=>a.id.localeCompare(b.id))}
}
