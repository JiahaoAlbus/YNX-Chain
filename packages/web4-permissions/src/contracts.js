import { createHash, timingSafeEqual } from "node:crypto";

const WALLET_REQUEST_FIELDS = ["version","nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","scopes","purpose","issuedAt","expiresAt"];
const AI_REQUEST_FIELDS = ["version","requestId","product","workflow","provider","model","context","locale","costEstimate","consent","issuedAt","expiresAt"];
const INDEX_RECEIPT_FIELDS = ["version","sourceId","sourceUrl","authorizationRef","robotsDecision","contentDigest","fetchedAt","indexedAt","revision","status"];

export const PRODUCT_BINDINGS = Object.freeze({
  "ynx-browser-android": Object.freeze({ requestingProduct:"browser", bundleId:"com.ynxweb4.browser", callbacks:["ynxbrowser://com.ynxweb4.browser/auth/callback"], scopes:["account:read","browser:wallet-request"] }),
  "ynx-browser-ios": Object.freeze({ requestingProduct:"browser", bundleId:"com.ynxweb4.browser.ios", callbacks:["ynxbrowser://com.ynxweb4.browser.ios/auth/callback"], scopes:["account:read","browser:wallet-request"] }),
  "ynx-browser-macos": Object.freeze({ requestingProduct:"browser", bundleId:"com.ynxweb4.browser.macos", callbacks:["ynxbrowser://com.ynxweb4.browser.macos/auth/callback"], scopes:["account:read","browser:wallet-request"] }),
  "ynx-browser-windows": Object.freeze({ requestingProduct:"browser", bundleId:"com.ynxweb4.browser.windows", callbacks:["ynxbrowser://com.ynxweb4.browser.windows/auth/callback"], scopes:["account:read","browser:wallet-request"] }),
  "ynx-search-web": Object.freeze({ requestingProduct:"search", bundleId:"com.ynxweb4.search.web", callbacks:["https://search.ynx.invalid/auth/callback"], scopes:["account:read","search:cases"] })
});

export function validateWalletAuthorizationV1(input,{now=Date.now(),registry=PRODUCT_BINDINGS}={}){
  exact(input,WALLET_REQUEST_FIELDS,"Wallet authorization request");
  bounded(input.version,/^1$/,"version");bounded(input.nonce,/^[A-Za-z0-9_-]{32,64}$/,"nonce");
  if(input.chainId!=="ynx_6423-1")throw new Error("wrong Wallet network");
  bounded(input.requestingProduct,/^[a-z][a-z0-9-]{1,31}$/,"requestingProduct");bounded(input.productClientId,/^[a-z][a-z0-9._-]{2,63}$/,"productClientId");bounded(input.bundleId,/^[A-Za-z][A-Za-z0-9.-]{2,127}$/,"bundleId");
  if(input.productDeviceAlgorithm!=="p256-sha256"||!/^[A-Za-z0-9_-]{44}$/.test(input.productDeviceKey??""))throw new Error("invalid product device binding");
  const binding=registry[input.productClientId];if(!binding)throw new Error("unknown Wallet product client");
  if(binding.requestingProduct!==input.requestingProduct||binding.bundleId!==input.bundleId)throw new Error("Wallet product binding mismatch");
  const callback=new URL(input.callback);if(callback.hash||callback.username||callback.password||callback.toString()!==input.callback||!binding.callbacks.includes(input.callback))throw new Error("Wallet callback mismatch");
  if(!Array.isArray(input.scopes)||input.scopes.length<1||input.scopes.length>8||new Set(input.scopes).size!==input.scopes.length||[...input.scopes].sort().join("\n")!==input.scopes.join("\n")||input.scopes.some(scope=>!binding.scopes.includes(scope)))throw new Error("Wallet scope not allowed");
  if(typeof input.purpose!=="string"||input.purpose.length<3||input.purpose.length>180)throw new Error("invalid Wallet purpose");
  const issued=Date.parse(input.issuedAt),expires=Date.parse(input.expiresAt);if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+30000||expires<=now||expires<=issued||expires-issued>300000)throw new Error("invalid Wallet request time");
  return Object.freeze(structuredClone(input));
}

export class NonceLedger{
  constructor({maximum=10000}={}){this.maximum=maximum;this.records=new Map()}
  consume(kind,nonce,expiresAt,now=Date.now()){const key=`${kind}:${nonce}`;for(const[item,expiry]of this.records)if(expiry<=now)this.records.delete(item);if(this.records.has(key))throw new Error(`${kind} replay rejected`);if(this.records.size>=this.maximum)throw new Error("replay ledger capacity reached");const expiry=Date.parse(expiresAt);if(!Number.isFinite(expiry)||expiry<=now)throw new Error("replay record already expired");this.records.set(key,expiry);return{key,expiresAt:new Date(expiry).toISOString()}}
  export(){return[...this.records].map(([key,expiresAt])=>({key,expiresAt}))}
  restore(records,now=Date.now()){for(const record of records??[]){if(typeof record.key==="string"&&Number.isFinite(record.expiresAt)&&record.expiresAt>now)this.records.set(record.key,record.expiresAt)}}
}

export function createConsentReceipt({id,product,workflow,contextClasses,sourceUrls=[],provider,model,locale,expiresAt},now=new Date()){
  if(!/^[A-Za-z0-9_-]{16,128}$/.test(id??""))throw new Error("invalid consent id");
  if(!["browser","search"].includes(product))throw new Error("invalid consent product");
  if(!Array.isArray(contextClasses)||contextClasses.length<1||contextClasses.some(value=>!["authorized-current-page","selected-tab","permission-request","signing-request","indexed-public-source-snippet"].includes(value)))throw new Error("invalid consent context");
  for(const url of sourceUrls)strictHttpUrl(url);
  const expiry=Date.parse(expiresAt);if(!Number.isFinite(expiry)||expiry<=now.getTime()||expiry-now.getTime()>300000)throw new Error("invalid consent expiry");
  const payload={version:"1",id,product,workflow,contextClasses:[...contextClasses],sourceUrls:[...sourceUrls],provider:String(provider),model:String(model),locale:String(locale),approvedAt:now.toISOString(),expiresAt:new Date(expiry).toISOString()};return Object.freeze({...payload,digest:canonicalDigest("YNX_AI_CONSENT_V1",payload)})
}

export function validateAiGatewayRequest(input,{now=Date.now()}={}){
  exact(input,AI_REQUEST_FIELDS,"AI Gateway request");bounded(input.version,/^1$/,"version");bounded(input.requestId,/^[A-Za-z0-9_-]{16,128}$/,"requestId");if(!["browser","search"].includes(input.product))throw new Error("invalid AI product");
  if(typeof input.provider!=="string"||!input.provider||typeof input.model!=="string"||!input.model)throw new Error("provider and model required");
  if(!input.consent||input.consent.digest!==canonicalDigest("YNX_AI_CONSENT_V1",Object.fromEntries(Object.entries(input.consent).filter(([key])=>key!=="digest"))))throw new Error("AI consent tampered");
  if(input.consent.product!==input.product||input.consent.workflow!==input.workflow)throw new Error("AI consent binding mismatch");
  if(input.consent.provider!==input.provider||input.consent.model!==input.model||input.consent.locale!==input.locale)throw new Error("AI provider, model or locale consent binding mismatch");
  if(!input.context||!Array.isArray(input.context.items)||input.context.items.length<1||input.context.items.length>8)throw new Error("bounded AI context required");
  for(const item of input.context.items){if(typeof item.text!=="string"||item.text.length>50000||item.private===true)throw new Error("private or oversized AI context");if(item.sourceUrl&&!input.consent.sourceUrls.includes(item.sourceUrl))throw new Error("AI context source not consented")}
  if(!input.costEstimate||!Number.isSafeInteger(input.costEstimate.inputTokens)||!Number.isSafeInteger(input.costEstimate.outputTokens)||input.costEstimate.inputTokens<0||input.costEstimate.outputTokens<0)throw new Error("invalid AI cost estimate");
  const issued=Date.parse(input.issuedAt),expires=Date.parse(input.expiresAt);if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+30000||expires<=now||expires-issued>300000||expires>Date.parse(input.consent.expiresAt))throw new Error("invalid AI request time");return Object.freeze(structuredClone(input))
}

export function validateAiGatewayResponse(response,request){if(!response||response.version!=="1"||response.requestId!==request.requestId)throw new Error("AI response binding mismatch");if(response.provider!==request.provider||response.model!==request.model)throw new Error("AI provider binding mismatch");if(!["complete","cancelled","failed","unavailable"].includes(response.status))throw new Error("invalid AI response status");const allowed=new Set(request.consent.sourceUrls);if(!Array.isArray(response.citations)||response.citations.some(url=>!allowed.has(url)))throw new Error("AI response cites unconsented source");if(!Array.isArray(response.retrieval)||!Array.isArray(response.inference))throw new Error("AI retrieval and inference must be separate");return Object.freeze(structuredClone(response))}

export function validateIndexReceipt(input){exact(input,INDEX_RECEIPT_FIELDS,"index receipt");if(input.version!=="1"||!input.sourceId||!input.authorizationRef)throw new Error("invalid index identity");new URL(input.sourceUrl);if(!["allowed","blocked","override-with-evidence"].includes(input.robotsDecision))throw new Error("invalid robots decision");if(!/^[0-9a-f]{64}$/.test(input.contentDigest??"")||!Number.isSafeInteger(input.revision)||input.revision<1||!["ready","removed","failed"].includes(input.status))throw new Error("invalid index receipt");if(Date.parse(input.indexedAt)<Date.parse(input.fetchedAt))throw new Error("index time precedes fetch");return Object.freeze(structuredClone(input))}

export function createTrustReferral({product,kind,objectId,sourceUrl,reason,evidenceUrls=[]}){if(!["browser","search"].includes(product)||!["abuse-removal","correction","appeal","phishing-report","ai-correction"].includes(kind))throw new Error("invalid Trust referral");if(!/^[A-Za-z0-9_-]{8,128}$/.test(objectId??"")||typeof reason!=="string"||reason.length<8||reason.length>2000)throw new Error("invalid Trust referral detail");const payload={version:"1",product,kind,objectId,sourceUrl:new URL(sourceUrl).href,reason,evidenceUrls:evidenceUrls.slice(0,10).map(url=>new URL(url).href),createdAt:new Date().toISOString()};return Object.freeze({...payload,digest:canonicalDigest("YNX_TRUST_REFERRAL_V1",payload)})}

export function canonicalDigest(domain,value){return createHash("sha256").update(`${domain}\n${canonicalJson(value)}`).digest("hex")}
export function verifyDigest(domain,value,digest){if(!/^[0-9a-f]{64}$/.test(digest??""))return false;return timingSafeEqual(Buffer.from(canonicalDigest(domain,value),"hex"),Buffer.from(digest,"hex"))}
function canonicalJson(value){if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(canonicalJson).join(",")}]`;return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`}
function strictHttpUrl(value){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash)throw new Error("invalid source URL");return url.href}
function exact(value,fields,label){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join("\n")!==[...fields].sort().join("\n"))throw new Error(`${label} fields mismatch`)}
function bounded(value,pattern,label){if(typeof value!=="string"||value.length>256||!pattern.test(value))throw new Error(`invalid ${label}`)}
