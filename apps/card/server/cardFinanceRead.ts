import {createHmac,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {CardError,subject,type Principal} from './contracts.ts';
import {CardStore} from './storage.ts';
import {CardProviderRegistry} from './providerRegistry.ts';
import {CardProviderLifecycle} from './providerLifecycle.ts';

export const CARD_FINANCE_READ_ROUTE='/api/card/v2/integrations/finance/account';
const scopes=['card.provider-activity.read','card.provider-transactions.read'] as const;
type Consent={owner:string;scopes:string[];expiresAt:string;revokedAt:string|null;grantedAt:string};
type ConsentState={consent:Consent|null};
type ReplayState={nonces:Record<string,string>};
const consentEmpty=():ConsentState=>({consent:null}),replayEmpty=():ReplayState=>({nonces:{}});
const consentKey=(owner:string)=>'card-finance-consent:'+owner;
const replayKey='card-finance-read-nonces';
const headers=['x-ynx-read-consumer','x-ynx-read-account','x-ynx-read-timestamp','x-ynx-read-nonce','x-ynx-read-signature'];

/** Card-owned Finance read producer. Finance's HMAC authenticates the service;
 * owner consent is a separate, revocable Product Session scoped record. */
export class CardFinanceRead {
  constructor(private readonly store:CardStore,private readonly registry:CardProviderRegistry,private readonly lifecycle:CardProviderLifecycle,private readonly secret:string|undefined,private readonly clock:()=>Date=()=>new Date()){
    if(secret!==undefined&&secret.length<32)throw Error('YNX_CARD_FINANCE_READ_KEY must have at least 32 characters');
  }
  grant(principal:Principal,requested:readonly string[],expiresAt:string){
    if(!principal.scopes.includes('card:finance:share')||Date.parse(principal.expiresAt)<=this.clock().getTime())throw new CardError('CARD_PERMISSION_DENIED',403);
    const owner=subject(principal.owner),expiry=Date.parse(expiresAt),now=this.clock().getTime();if(!Number.isFinite(expiry)||expiry<=now||expiry>now+30*86400000)throw new CardError('FINANCE_CONSENT_EXPIRY_INVALID',400);
    if(!Array.isArray(requested)||requested.length===0||new Set(requested).size!==requested.length||requested.some(scope=>typeof scope!=='string'||!scopes.includes(scope as never)))throw new CardError('FINANCE_CONSENT_SCOPE_INVALID',400);
    return this.store.transaction(consentKey(owner),consentEmpty,state=>{state.consent={owner,scopes:[...requested],expiresAt:new Date(expiry).toISOString(),revokedAt:null,grantedAt:this.clock().toISOString()};return state.consent});
  }
  revoke(principal:Principal){if(!principal.scopes.includes('card:finance:share')||Date.parse(principal.expiresAt)<=this.clock().getTime())throw new CardError('CARD_PERMISSION_DENIED',403);const owner=subject(principal.owner);return this.store.transaction(consentKey(owner),consentEmpty,state=>{if(state.consent)state.consent.revokedAt=this.clock().toISOString();return state.consent})}
  consent(principal:Principal){return this.store.read(consentKey(subject(principal.owner)),consentEmpty).consent}
  read(request:IncomingMessage){
    if(!this.secret)throw new CardError('FINANCE_READ_UNCONFIGURED',503);
    if(request.method!=='GET'||request.url!==CARD_FINANCE_READ_ROUTE)throw new CardError('FINANCE_READ_ROUTE_INVALID',404);
    const counts=new Map<string,number>();for(let i=0;i<request.rawHeaders.length;i+=2){const name=request.rawHeaders[i]!.toLowerCase();counts.set(name,(counts.get(name)??0)+1)}
    if(headers.some(name=>counts.get(name)!==1))throw new CardError('FINANCE_READ_CREDENTIAL_INVALID',401);
    const h=request.headers,consumer=h[headers[0]!]!,account=h[headers[1]!]!,timestamp=h[headers[2]!]!,nonce=h[headers[3]!]!,signature=h[headers[4]!]!;
    if(typeof consumer!=='string'||consumer!=='finance'||typeof account!=='string'||typeof timestamp!=='string'||typeof nonce!=='string'||typeof signature!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(timestamp)||!/^[0-9a-f]{32}$/.test(nonce)||!/^[0-9a-f]{64}$/.test(signature))throw new CardError('FINANCE_READ_CREDENTIAL_INVALID',401);
    const owner=subject(account),at=Date.parse(timestamp),now=this.clock().getTime();if(!Number.isFinite(at)||Math.abs(now-at)>30000)throw new CardError('FINANCE_READ_CREDENTIAL_EXPIRED',401);
    const canonical=['YNX_READ_INTEGRATION_V1','finance','card','GET',CARD_FINANCE_READ_ROUTE,account,timestamp,nonce].join('\n');const expected=createHmac('sha256',this.secret).update(canonical).digest();const supplied=Buffer.from(signature,'hex');if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new CardError('FINANCE_READ_CREDENTIAL_INVALID',401);
    this.store.transaction(replayKey,replayEmpty,state=>{for(const [used,expiry] of Object.entries(state.nonces))if(Date.parse(expiry)<=now)delete state.nonces[used];if(state.nonces[nonce]||Object.keys(state.nonces).length>=100000)throw new CardError('FINANCE_READ_REPLAYED',409);state.nonces[nonce]=new Date(now+60000).toISOString();return null});
    const consent=this.store.read(consentKey(owner),consentEmpty).consent;if(!consent||consent.owner!==owner||consent.revokedAt||Date.parse(consent.expiresAt)<=now)throw new CardError('FINANCE_READ_CONSENT_REQUIRED',403);
    const principal:Principal={owner,chainId:'0x1917',expiresAt:new Date(now+1000).toISOString(),scopes:['account:read']};
    const overview=this.registry.overview(principal),cards=overview.cards.map(card=>({productCardId:card.productCardId,provider:card.provider,programId:card.programId,environment:card.environment,status:card.status,sourceAsOf:card.sourceAsOf,spendableBalance:null}));
    const activities=consent.scopes.includes('card.provider-activity.read')?cards.flatMap(card=>{const entries=[];let cursor=0;for(;;){const page=this.registry.activity(principal,card.productCardId,cursor,100);entries.push(...page.items);if(page.nextCursor===null)break;if(entries.length>=5000)throw new CardError('FINANCE_CARD_HISTORY_TOO_LARGE',503);cursor=page.nextCursor}return entries}):[];
    const transactions=consent.scopes.includes('card.provider-transactions.read')?this.lifecycle.recordedHistory(principal):[];
    if(cards.length===0&&activities.length===0&&transactions.length===0)throw new CardError('FINANCE_CARD_RECORD_NOT_FOUND',404);
    return {envelopeVersion:'finance-source-read-envelope-v1',sourceId:'card',owner:'card',network:'ynx_6423-1',nativeAsset:'YNXT',authorizedAccount:owner,ownerContractVersion:'card-finance-read-v1',payloadSchema:'ynx-card-finance-account-v1',asOf:this.clock().toISOString(),asOfKind:'card-persisted-provider-read-model-observed-at',coverage:'owner-consented Card TEST provider metadata and readback records',syncStatus:'local-read-model-provider-verification-independent',readOnly:true,capabilities:consent.scopes,payload:{product:'card',providerEnvironment:'TEST',cards,activities,transactions,spendableBalance:null,balanceAuthority:'none',simulationAndProviderFundsSeparated:true}};
  }
}
