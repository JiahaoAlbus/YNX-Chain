import{createRequestContext}from'./request-context.js';
export const API_BASE=(globalThis.YNX_PAY_API_URL??"").replace(/\/$/,"");
export class PayAPI{constructor(token="",requests=createRequestContext(()=>token)){this.token=token;this.requests=requests}async state(){return this.authorized("GET","/v1/merchant/state")}async analytics(){return this.authorized("GET","/v1/merchant/analytics")}async catalog(input){return this.authorized("POST","/v1/merchant/catalog",input)}async invoice(input){return this.authorized("POST","/v1/merchant/invoices",input)}async recurring(input){return this.authorized("POST","/v1/merchant/recurring-drafts",input)}async webhook(endpoint){return this.authorized("PUT","/v1/merchant/webhook",{endpoint})}async rotate(){return this.authorized("POST","/v1/merchant/webhook/rotate",{})}async retry(id,reason="manual operator replay",idempotencyKey=`manual-${id}-${Date.now()}`){return this.authorized("POST",`/v1/merchant/webhooks/${encodeURIComponent(id)}/retry`,{reason,idempotencyKey})}async submitRefund(id,authorization,idempotencyKey){return this.authorized("POST",`/v1/merchant/refunds/${encodeURIComponent(id)}/submit`,{authorization,idempotencyKey})}async refreshRefund(id){return this.authorized("POST",`/v1/merchant/refunds/${encodeURIComponent(id)}/refresh`,{})}async ai(input){return this.authorized("POST","/v1/merchant/ai/runs",input)}async reviewAI(id,decision){return this.authorized("POST",`/v1/merchant/ai/runs/${encodeURIComponent(id)}/review`,{decision})}async member(account,role){return this.authorized("POST","/v1/merchant/members",{account,role})}async export(){return this.authorized("GET","/v1/merchant/reconciliation.csv",undefined,true)}async authorized(method,path,value,raw=false){if(!this.token)throw new Error("Active Wallet/Gateway session required");return request(path,{method,body:value,headers:{Authorization:`Bearer ${this.token}`},raw,requests:this.requests})}}
async function request(path,{method="GET",body,headers={},raw=false,requests}={}){
 if(!API_BASE)throw new Error("YNX Pay product service URL is not configured");
 return requests.fetchJSON(API_BASE+path,{method,headers:{...headers,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)},globalThis.fetch,raw?response=>response.ok?response.blob():response.json():undefined);
}
const ROLES=new Set(['owner','finance','developer','support','viewer']);
function rejected(){return Object.assign(new Error('The selected merchant, account or membership is no longer valid. Approve a new sign-in.'),{code:'MERCHANT_CONTEXT_REJECTED',status:401})}
function records(value){if(value===undefined||value===null)return [];if(typeof value!=='object'||Array.isArray(value))throw rejected();const rows=Object.values(value);if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw rejected();return rows}
// Original Pay snapshot fields identify every merchant-owned collection. Local
// saved role/selection are navigation hints; they never establish membership.
export function realRecords(snapshot,{merchantId,account,expectedRole=null}={}){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||typeof merchantId!=='string'||!merchantId||typeof account!=='string'||!account)throw rejected();
 const selected=records(snapshot.merchants).filter(row=>row.id===merchantId);
 if(selected.length!==1||selected[0].status!=='active')throw rejected();
 const members=records(snapshot.merchantMembers),matches=members.filter(row=>row.merchantId===merchantId&&row.account===account);
 if(matches.length!==1||matches[0].status!=='active'||!ROLES.has(matches[0].role)||expectedRole!==null&&matches[0].role!==expectedRole)throw rejected();
 const scoped=value=>{const rows=records(value);if(rows.some(row=>typeof row.merchantId!=='string'))throw rejected();return rows.filter(row=>row.merchantId===merchantId)};
 if(snapshot.audit!==undefined&&snapshot.audit!==null&&!Array.isArray(snapshot.audit))throw rejected();
 const audit=snapshot.audit??[];if(audit.some(row=>!row||typeof row!=='object'||typeof row.merchantId!=='string'))throw rejected();
 return {merchant:selected[0],role:matches[0].role,members:scoped(snapshot.merchantMembers),catalog:scoped(snapshot.catalog),invoices:scoped(snapshot.invoices),recurringDrafts:scoped(snapshot.recurringDrafts),refunds:scoped(snapshot.refunds),disputes:scoped(snapshot.disputes),deliveries:scoped(snapshot.deliveries),aiRuns:scoped(snapshot.aiRuns),audit:audit.filter(row=>row.merchantId===merchantId)};
}
export function merchantAnalytics(value,merchantId){if(!value||typeof value!=='object'||Array.isArray(value)||value.merchantId!==merchantId)throw rejected();return value}
