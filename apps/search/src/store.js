import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalDigest, validateIndexReceipt } from "../../../packages/web4-permissions/src/index.js";
import { validateOutboundUrlSyntax } from "./network.js";
import { ENTITY_REGISTRY, inferQueryIntent, normalizeEntityQuery, resolveEntities } from "./entities.js";
import { SEARCH_DATA_POLICY, assertPublicIndexContent, validateAllowedDataClasses, validateDocumentDataClass } from "./data-policy.js";

const EMPTY = { version: 4, revision: 0, sources: {}, documents: {}, cases: {}, aiAudit: [], privacyAudit: [], walletChallenges: {} };
function migrateDatabase(input) {
  const db = { ...structuredClone(EMPTY), ...input };
  if ((input?.version ?? 0) < 4) {
    for (const source of Object.values(db.sources)) {
      if (!source.authorization || !source.robots || !source.crawlPolicy || !source.dataRights || !source.dataPolicy?.allowedClasses?.length || !source.dataPolicy?.defaultClass) {
        source.enabled = false;
        source.indexingStatus = "disabled";
        source.migrationRequired = "source-registry-v4";
        source.lastError = "source registry v4 migration requires explicit public data-class review";
      }
    }
    db.version = 4;
  }
  return db;
}
async function read(path) { try { return migrateDatabase(JSON.parse(await readFile(path, "utf8"))); } catch (e) { if (e.code === "ENOENT") return structuredClone(EMPTY); throw e; } }
async function write(path, data) { data.revision=(data.revision??0)+1;await mkdir(dirname(path), { recursive: true }); const temp=`${path}.${process.pid}.tmp`; await writeFile(temp,`${JSON.stringify(data,null,2)}\n`,{mode:0o600}); await rename(temp,path); }
const words = value => (value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 100_000);
const idFor = value => createHash("sha256").update(value).digest("hex");
const countTerm = (values, term) => values.reduce((count, value) => count + (value === term ? 1 : 0), 0);
const authorityScore = source => ({ "ynx-official": 8, "authorized-public": 5, "external-provider": 3 }[source.sourceType] ?? 0);
const qualityScore = source => [source.authorization?.referenceDigest, source.terms?.url, source.remedies?.removalUrl, source.remedies?.correctionUrl, source.languages?.length, source.dataRights?.storage, source.dataPolicy?.allowedClasses?.length].filter(Boolean).length;

function freshnessScore(document, nowMs) {
  const timestamp = Date.parse(document.publishedAt ?? document.fetchedAt ?? document.indexedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (nowMs - timestamp) / 86_400_000);
  if (ageDays <= 1) return 6;
  if (ageDays <= 7) return 4;
  if (ageDays <= 30) return 2;
  if (ageDays <= 365) return 1;
  return 0;
}

function entityScore(document, entities) {
  const searchable = normalizeEntityQuery(`${document.title} ${document.url}`);
  let score = 0;
  for (const entity of entities) {
    const canonical = normalizeEntityQuery(entity.canonicalName);
    if (document.url === entity.canonicalUrl || searchable.includes(canonical)) score = Math.max(score, entity.match.type === "exact-alias" ? 40 : 20);
  }
  return score;
}

function explanationFor(factors) {
  return Object.entries(factors)
    .filter(([key, value]) => key !== "vector" && value !== 0)
    .sort(([, left], [, right]) => Math.abs(right) - Math.abs(left))
    .map(([key, value]) => `${key}:${value > 0 ? "+" : ""}${value}`);
}

function requiredText(value, field, minimum = 3, maximum = 500) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) throw new Error(`${field} required`);
  return result;
}

function governanceUrl(value, field) {
  const url = validateOutboundUrlSyntax(value);
  if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS`);
  return url.href;
}

export function validateSource(input) {
  const url = validateOutboundUrlSyntax(input.url);
  const authorizationEvidence = requiredText(input.authorizationEvidence, "authorization evidence", 8);
  const owner = requiredText(input.owner, "source owner");
  const sourceType = input.sourceType ?? "authorized-public";
  if (!["ynx-official", "authorized-public", "external-provider"].includes(sourceType)) throw new Error("invalid source type");
  if (!["respect", "explicit-override"].includes(input.robotsPolicy)) throw new Error("robots policy required");
  if (input.robotsPolicy === "explicit-override" && String(input.overrideEvidence ?? "").trim().length < 8) throw new Error("robots override evidence required");
  const permittedScope = [...new Set((input.permittedScope ?? []).map(value => requiredText(value, "permitted scope", 1, 200)))];
  if (!permittedScope.length || permittedScope.length > 20) throw new Error("permitted scope required");
  const languages = [...new Set((input.languages ?? []).map(value => requiredText(value, "language", 2, 35)))];
  if (!languages.length || languages.length > 24) throw new Error("source languages required");
  const allowedDataClasses = validateAllowedDataClasses(input.allowedDataClasses);
  const defaultDataClass = requiredText(input.defaultDataClass, "default data class", 3, 80);
  if (!allowedDataClasses.includes(defaultDataClass)) throw new Error("default data class must be allowed by source policy");
  const permittedUse = input.permittedUse ?? "index-snippet-link";
  if (!["metadata-only", "index-snippet-link", "index-fulltext-link"].includes(permittedUse)) throw new Error("invalid permitted use");
  const retentionDays = Number(input.retentionDays);
  const freshnessSloSeconds = Number(input.freshnessSloSeconds);
  const maxRequestsPerMinute = Number(input.maxRequestsPerMinute);
  const backoffSeconds = Number(input.backoffSeconds);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("retention days required");
  if (!Number.isInteger(freshnessSloSeconds) || freshnessSloSeconds < 60 || freshnessSloSeconds > 31_536_000) throw new Error("freshness SLO required");
  if (!Number.isInteger(maxRequestsPerMinute) || maxRequestsPerMinute < 2 || maxRequestsPerMinute > 600) throw new Error("source rate limit required");
  if (!Number.isInteger(backoffSeconds) || backoffSeconds < 30 || backoffSeconds > 86_400) throw new Error("source backoff required");
  return {
    id: input.id ?? idFor(url.origin),
    url: url.href,
    origin: url.origin,
    label: String(input.label ?? url.hostname).slice(0, 120),
    sourceType,
    owner,
    jurisdiction: requiredText(input.jurisdiction, "jurisdiction", 2, 120),
    authorization: {
      reference: authorizationEvidence.slice(0, 500),
      referenceDigest: idFor(authorizationEvidence),
      reviewedAt: new Date(input.authorizationReviewedAt ?? Date.now()).toISOString(),
    },
    robots: {
      policy: input.robotsPolicy,
      overrideReference: input.overrideEvidence?.slice(0, 500) ?? null,
      overrideReferenceDigest: input.overrideEvidence ? idFor(input.overrideEvidence) : null,
    },
    permittedScope,
    terms: { url: governanceUrl(input.termsUrl, "terms URL"), permittedUse },
    dataRights: {
      storage: input.storageRight !== false,
      snippets: input.snippetRight !== false,
      aiRetrieval: input.aiRetrievalRight === true,
    },
    dataPolicy: {
      version: SEARCH_DATA_POLICY.version,
      allowedClasses: allowedDataClasses,
      defaultClass: defaultDataClass,
    },
    retentionDays,
    remedies: {
      removalUrl: governanceUrl(input.removalUrl, "removal URL"),
      correctionUrl: governanceUrl(input.correctionUrl, "correction URL"),
    },
    languages,
    crawlPolicy: { freshnessSloSeconds, maxRequestsPerMinute, backoffSeconds },
    enabled: input.enabled !== false,
  };
}

export class SearchStore {
  constructor(path,{clock=()=>new Date().toISOString()}={}) { this.path=path; this.clock=clock; this.queue=Promise.resolve(); }
  async snapshot(){await this.queue;return read(this.path)}
  async mutate(operation){const run=this.queue.catch(()=>{}).then(async()=>{const db=await read(this.path);const result=await operation(db);await write(this.path,db);return result});this.queue=run.then(()=>undefined,()=>undefined);return run}
  async registerSource(input){const source=validateSource(input);return this.mutate(db=>{db.sources[source.id]={...source,indexingStatus:"registered",lastAttemptAt:null,lastIndexedAt:null,nextEligibleAt:null,lastError:null,documentCount:db.sources[source.id]?.documentCount??0};return db.sources[source.id]})}
  async setSourceStatus(id,status,details={}){if(!['registered','checking-robots','indexing','ready','blocked-by-robots','backoff','failed','disabled'].includes(status))throw new Error("invalid indexing status");return this.mutate(db=>{if(!db.sources[id])throw new Error("source not found");Object.assign(db.sources[id],{indexingStatus:status,...details});return db.sources[id]})}
  async indexDocument(sourceId,input){
    return this.mutate(db=>{
      const source=db.sources[sourceId];
      if(!source||!source.enabled)throw new Error("enabled source required");
      const url=new URL(input.url);
      if(url.origin!==source.origin)throw new Error("document origin is outside registered source");
      const text=String(input.text??"").replace(/\s+/g," ").trim();
      if(text.length<20||text.length>2_000_000)throw new Error("document text size invalid");
      const title=String(input.title??url.pathname).slice(0,300);
      const dataClass=validateDocumentDataClass(source,input.dataClass??source.dataPolicy.defaultClass);
      assertPublicIndexContent(`${title}\n${url.href}\n${text}`);
      const indexedAt=this.clock(),fetchedAt=input.fetchedAt??indexedAt,id=idFor(url.href),contentDigest=createHash("sha256").update(text).digest("hex");
      const receipt=validateIndexReceipt({version:"1",sourceId,sourceUrl:url.href,authorizationRef:source.authorization.referenceDigest,robotsDecision:source.robots.policy==="respect"?"allowed":"override-with-evidence",contentDigest,fetchedAt,indexedAt,revision:(db.revision??0)+1,status:"ready"});
      db.documents[id]={id,sourceId,url:url.href,title,text,dataClass,language:input.language??source.languages[0]??null,contentType:input.contentType??"text/html",publishedAt:input.publishedAt??null,fetchedAt,indexedAt,contentDigest,indexReceipt:{...receipt,digest:canonicalDigest("YNX_INDEX_RECEIPT_V1",receipt)},terms:words(`${title} ${text}`)};
      source.documentCount=Object.values(db.documents).filter(d=>d.sourceId===sourceId).length;
      source.lastIndexedAt=indexedAt;source.indexingStatus="ready";source.lastError=null;
      return db.documents[id]
    })
  }
  async search(query,{page=1,pageSize=10,sourceId=null,freshnessDays=null,contentType=null,language=null,dataClass=null,aiRetrievalOnly=false}={}){
    const q=String(query??"").trim();
    if(q.length<1||q.length>256)throw new Error("query length invalid");
    if(!Number.isInteger(page)||page<1||page>1000)throw new Error("invalid page");
    if(!Number.isInteger(pageSize)||pageSize<1||pageSize>50)throw new Error("invalid page size");
    const dataClassFilter=dataClass?validateAllowedDataClasses([dataClass])[0]:null;
    const terms=words(q),normalizedQuery=normalizeEntityQuery(q),entityMatches=resolveEntities(q),queryIntent=inferQueryIntent(q,entityMatches);
    await this.queue;
    const db=await read(this.path),clockMs=Date.parse(this.clock()),nowMs=Number.isFinite(clockMs)?clockMs:Date.now(),cutoff=freshnessDays?nowMs-freshnessDays*86400000:null;
    const candidates=Object.values(db.documents).filter(doc=>{const source=db.sources[doc.sourceId];return source?.enabled===true&&(!aiRetrievalOnly||source.dataRights?.aiRetrieval===true)&&(!sourceId||doc.sourceId===sourceId)&&(!contentType||doc.contentType===contentType)&&(!language||doc.language===language||source.languages?.includes(language))&&(!dataClassFilter||doc.dataClass===dataClassFilter)&&(!cutoff||Date.parse(doc.publishedAt??doc.fetchedAt)>=cutoff)}).map(doc=>{
      const source=db.sources[doc.sourceId],titleTerms=words(doc.title),normalizedDocument=normalizeEntityQuery(`${doc.title} ${doc.text}`);
      const factors={
        lexical:terms.reduce((score,term)=>score+countTerm(doc.terms,term),0),
        title:terms.reduce((score,term)=>score+countTerm(titleTerms,term)*4,0),
        exactPhrase:normalizedQuery.length>1&&normalizedDocument.includes(normalizedQuery)?12:0,
        exactEntity:entityScore(doc,entityMatches),
        authority:authorityScore(source),
        freshness:freshnessScore(doc,nowMs),
        language:language&&(doc.language===language||source.languages?.includes(language))?3:0,
        sourceQuality:qualityScore(source),
        domainDiversity:0,
        duplicatePenalty:0,
        vector:0
      };
      const relevance=factors.lexical+factors.title+factors.exactPhrase+factors.exactEntity;
      return{doc,source,factors,relevance,score:Object.values(factors).reduce((sum,value)=>sum+value,0)}
    }).filter(item=>item.relevance>0).sort((left,right)=>right.score-left.score||Date.parse(right.doc.fetchedAt)-Date.parse(left.doc.fetchedAt)||left.doc.url.localeCompare(right.doc.url));
    const digestCounts=new Map(),originCounts=new Map();
    for(const item of candidates){
      const digestCount=digestCounts.get(item.doc.contentDigest)??0,origin=new URL(item.doc.url).origin,originCount=originCounts.get(origin)??0;
      item.factors.duplicatePenalty=-Math.min(20,digestCount*10);
      item.factors.domainDiversity=originCount===0?2:-Math.min(6,originCount*2);
      item.score+=item.factors.duplicatePenalty+item.factors.domainDiversity;
      digestCounts.set(item.doc.contentDigest,digestCount+1);originCounts.set(origin,originCount+1)
    }
    candidates.sort((left,right)=>right.score-left.score||Date.parse(right.doc.fetchedAt)-Date.parse(left.doc.fetchedAt)||left.doc.url.localeCompare(right.doc.url));
    const start=(page-1)*pageSize;
    return{
      query:q,
      retrieval:"explainable-ranked-index",
      retrievalVersion:"3",
      inference:false,
      queryIntent,
      entityRegistryVersion:ENTITY_REGISTRY.version,
      entityMatches:entityMatches.map(({aliases,...entity})=>({...entity,source:"ynx-entity-registry",asOf:ENTITY_REGISTRY.effectiveAt})),
      correction:{applied:false,suggestion:null,policy:ENTITY_REGISTRY.correctionPolicy},
      vectorRetrieval:{status:"candidate-disabled",scoreUsed:false},
      dataPolicyVersion:SEARCH_DATA_POLICY.version,
      appliedFilters:{sourceId,freshnessDays,contentType,language,dataClass:dataClassFilter,aiRetrievalOnly},
      page,pageSize,total:candidates.length,totalPages:Math.ceil(candidates.length/pageSize),
      results:candidates.slice(start,start+pageSize).map(({doc,source,factors,score})=>({
        resultType:"indexed-document",
        title:doc.title,
        sourceUrl:doc.url,
        sourceLabel:source.label??doc.sourceId,
        sourceScope:source.permittedScope,
        dataClass:doc.dataClass,
        language:doc.language,
        freshness:{publishedAt:doc.publishedAt,fetchedAt:doc.fetchedAt,indexedAt:doc.indexedAt},
        indexReceiptDigest:doc.indexReceipt?.digest??null,
        contentType:doc.contentType,
        score,
        ranking:{version:"2",queryIntent,factors,whyThisResult:explanationFor(factors),authorityBasis:"registered source type policy",sourceQualityBasis:"source governance completeness proxy",vectorStatus:"candidate-disabled"},
        remedies:{removalUrl:source.remedies?.removalUrl??null,correctionUrl:source.remedies?.correctionUrl??null,appealEndpoint:"/api/appeal"},
        snippet:snippet(doc.text,terms)
      })),
      indexStatus:Object.values(db.sources).map(({id,label,url,indexingStatus,lastIndexedAt,lastError,nextEligibleAt,migrationRequired,documentCount})=>({id,label,url,indexingStatus,lastIndexedAt,lastError,nextEligibleAt,migrationRequired,documentCount}))
    }
  }
  async createCase(kind,input){if(!['removal','correction','appeal'].includes(kind))throw new Error("invalid case kind");const sourceUrl=new URL(input.sourceUrl).href;const reason=String(input.reason??"").trim();if(reason.length<8||reason.length>2000)throw new Error("case reason length invalid");return this.mutate(db=>{if(kind==='appeal'&&(!input.parentCaseId||!db.cases[input.parentCaseId]))throw new Error("appeal requires existing parent case");const item={id:randomUUID(),kind,sourceUrl,reason,evidenceUrls:(input.evidenceUrls??[]).slice(0,10).map(value=>new URL(value).href),parentCaseId:input.parentCaseId??null,status:"submitted",createdAt:this.clock(),updatedAt:this.clock(),audit:[{event:"submitted",at:this.clock()}]};db.cases[item.id]=item;return item})}
  async updateCase(id,status,note,actor="operator"){if(!['under-review','accepted','rejected','corrected','removed'].includes(status))throw new Error("invalid case status");return this.mutate(db=>{const item=db.cases[id];if(!item)throw new Error("case not found");item.status=status;item.updatedAt=this.clock();item.audit.push({event:status,note:String(note??"").slice(0,1000),actor,at:this.clock()});if(status==='removed')for(const [docId,doc] of Object.entries(db.documents))if(doc.url===item.sourceUrl)delete db.documents[docId];return item})}
  async auditAi(record){return this.mutate(db=>{db.aiAudit.unshift({id:randomUUID(),...record,at:this.clock()});db.aiAudit=db.aiAudit.slice(0,1000)})}
  async createWalletChallenge(record){return this.mutate(db=>{db.walletChallenges[record.nonce]={...record,status:"pending",createdAt:this.clock()};return db.walletChallenges[record.nonce]})}
  async consumeWalletChallenge(nonce,{chainId,productClientId,bundleId}){return this.mutate(db=>{const item=db.walletChallenges[nonce];if(!item||item.status!=="pending")throw new Error("wallet callback replay or unknown nonce");if(Date.parse(item.expiresAt)<=Date.now())throw new Error("wallet callback expired");if(chainId!==item.chainId||productClientId!==item.productClientId||bundleId!==item.bundleId)throw new Error("wallet callback product binding mismatch");item.status="gateway-verification-required";item.consumedAt=this.clock();return{verified:false,status:item.status}})}
  async clearPrivateData({walletChallenges=true,aiAudit=true}={}){return this.mutate(db=>{if(walletChallenges)db.walletChallenges={};if(aiAudit)db.aiAudit=[];db.privacyAudit.unshift({id:randomUUID(),event:"user-private-data-cleared",walletChallenges,aiAudit,at:this.clock()});db.privacyAudit=db.privacyAudit.slice(0,100);return{cleared:{walletChallenges,aiAudit},retained:["public source index","moderation cases","operator audit"]}})}
}

function snippet(text,terms){const lower=text.toLocaleLowerCase();let index=Math.min(...terms.map(term=>{const i=lower.indexOf(term);return i<0?Infinity:i}));if(!Number.isFinite(index))index=0;const start=Math.max(0,index-90);return `${start?'…':''}${text.slice(start,start+280)}${start+280<text.length?'…':''}`}
