import type { AuthorizationRequest } from "@ynx-chain/wallet-auth";

export type ProviderState = Readonly<{ available:boolean; provider:string|null; model:string|null; detail:string }>;
export type ReviewEstimate = Readonly<{ resourceUnits:number; maximumMonetaryCostYNXT:number; contextClasses:readonly string[] }>;
export type ReviewAudit = Readonly<{ id:string; at:string; action:string; provider:string|null; model:string|null; requestNonce:string; contextClasses:readonly string[]; resourceUnits:number; result:string }>;
export type ReviewSnapshot = Readonly<{
  phase:"selected"|"preview"|"permission"|"streaming"|"review"|"applied"|"rejected"|"cancelled"|"unavailable"|"failed";
  request:AuthorizationRequest;
  provider:ProviderState|null;
  estimate:ReviewEstimate;
  allowed:boolean;
  output:string;
  error:string|null;
  audits:readonly ReviewAudit[];
}>;

export type SecurityReviewProvider = {
  status(signal?:AbortSignal):Promise<ProviderState>;
  stream(input:{prompt:string;context:Readonly<Record<string,unknown>>;signal:AbortSignal;onToken:(token:string)=>void}):Promise<void>;
};

export class SecurityReviewController {
  private value: ReviewSnapshot;
  private aborter: AbortController | null = null;
  constructor(request: AuthorizationRequest, private readonly now:()=>Date=()=>new Date()) {
    this.value = freeze({ phase:"selected", request, provider:null, estimate:estimate(request), allowed:false, output:"", error:null, audits:[] });
  }
  snapshot():ReviewSnapshot { return this.value; }
  preview():ReviewSnapshot { return this.set({ phase:"preview", error:null }); }
  async checkProvider(provider:SecurityReviewProvider):Promise<ReviewSnapshot> {
    const state = await provider.status();
    return this.set({ provider:state, phase:state.available?"permission":"unavailable", error:state.available?null:state.detail });
  }
  allow():ReviewSnapshot {
    if (!this.value.provider?.available) throw new Error("A provider-backed model must be available before permission");
    return this.set({ allowed:true, phase:"permission", audits:this.audit("permission-granted", "pending") });
  }
  async run(provider:SecurityReviewProvider):Promise<ReviewSnapshot> {
    if (!this.value.allowed || !this.value.provider?.available) throw new Error("Review requires explicit permission and an available provider");
    this.aborter = new AbortController();
    this.set({ phase:"streaming", output:"", error:null });
    try {
      await provider.stream({ prompt:promptFor(this.value.request), context:safeContext(this.value.request), signal:this.aborter.signal, onToken:(token)=>this.set({output:this.value.output+token}) });
      if (this.aborter.signal.aborted) return this.set({ phase:"cancelled", audits:this.audit("stream-cancelled", "cancelled") });
      return this.set({ phase:"review", audits:this.audit("provider-result", "ready-for-review") });
    } catch (error) {
      if (this.aborter.signal.aborted) return this.set({ phase:"cancelled", audits:this.audit("stream-cancelled", "cancelled") });
      return this.set({ phase:"failed", error:error instanceof Error?error.message:String(error), audits:this.audit("provider-failed", "retry-available") });
    } finally { this.aborter=null; }
  }
  cancel():void { this.aborter?.abort(); }
  apply():ReviewSnapshot { if (this.value.phase!=="review") throw new Error("Only a reviewed result can be applied"); return this.set({phase:"applied",audits:this.audit("result-applied", "advisory-only")}); }
  reject():ReviewSnapshot { if (this.value.phase!=="review") throw new Error("Only a reviewed result can be rejected"); return this.set({phase:"rejected",audits:this.audit("result-rejected", "no-change")}); }
  retry():ReviewSnapshot { if (this.value.phase!=="failed"&&this.value.phase!=="unavailable"&&this.value.phase!=="cancelled") throw new Error("Retry is unavailable in this state"); return this.set({phase:"preview",error:null,output:"",allowed:false,audits:this.audit("retry", "permission-required")}); }
  private audit(action:string,result:string):readonly ReviewAudit[] {
    const at=this.now().toISOString();
    return Object.freeze([...this.value.audits,Object.freeze({id:`${this.value.request.nonce}:${this.value.audits.length+1}`,at,action,provider:this.value.provider?.provider??null,model:this.value.provider?.model??null,requestNonce:this.value.request.nonce,contextClasses:this.value.estimate.contextClasses,resourceUnits:this.value.estimate.resourceUnits,result})]);
  }
  private set(patch:Partial<ReviewSnapshot>):ReviewSnapshot { this.value=freeze({...this.value,...patch}); return this.value; }
}

export class GatewaySecurityReviewProvider implements SecurityReviewProvider {
  constructor(private readonly baseURL:string, private readonly productSessionToken:string) {}
  async status(signal?:AbortSignal):Promise<ProviderState> {
    if (!this.baseURL || !this.productSessionToken) return Object.freeze({available:false,provider:null,model:null,detail:"Wallet AI Gateway product session is unavailable. No local or canned answer will be substituted."});
    const response=await fetch(`${this.baseURL.replace(/\/$/,"")}/health`,{signal,headers:{Authorization:`Bearer ${this.productSessionToken}`}});
    if (!response.ok) return Object.freeze({available:false,provider:null,model:null,detail:`AI Gateway health returned ${response.status}`});
    const value=await response.json() as Record<string,unknown>;
    const provider=typeof value.provider==="string"?value.provider:null, model=typeof value.model==="string"?value.model:null;
    const available=value.providerConfigured===true&&provider!==null&&model!==null;
    return Object.freeze({available,provider,model,detail:available?"Provider-backed review is ready":"Provider is not configured"});
  }
  async stream(input:{prompt:string;context:Readonly<Record<string,unknown>>;signal:AbortSignal;onToken:(token:string)=>void}):Promise<void> {
    const query=new URLSearchParams({session:"wallet-security-review",q:`${input.prompt}\nContext: ${JSON.stringify(input.context)}`});
    const response=await fetch(`${this.baseURL.replace(/\/$/,"")}/ai/stream?${query}`,{signal:input.signal,headers:{Authorization:`Bearer ${this.productSessionToken}`,Accept:"text/event-stream"}});
    if (!response.ok) throw new Error(`AI Gateway stream returned ${response.status}`);
    const text=await response.text();
    for (const block of text.split("\n\n")) {
      const event=block.split("\n").find((line)=>line.startsWith("event:"))?.slice(6).trim();
      const data=block.split("\n").find((line)=>line.startsWith("data:"))?.slice(5).trim();
      if (event==="token"&&data) { const parsed=JSON.parse(data) as {token?:unknown}; if(typeof parsed.token==="string") input.onToken(parsed.token); }
    }
  }
}

function estimate(request:AuthorizationRequest):ReviewEstimate { return Object.freeze({resourceUnits:Math.max(1,request.scopes.length),maximumMonetaryCostYNXT:0,contextClasses:Object.freeze(["requesting-app-identity","requested-scopes","purpose","expiry","network"]) }); }
function safeContext(request:AuthorizationRequest):Readonly<Record<string,unknown>> { return Object.freeze({requestingProduct:request.requestingProduct,productClientId:request.productClientId,bundleId:request.bundleId,chainId:request.chainId,scopes:request.scopes,purpose:request.purpose,expiresAt:request.expiresAt}); }
function promptFor(_request:AuthorizationRequest):string { return "Explain the selected Sign in with YNX Wallet scopes, material risks, and least-privilege implications. Do not approve, sign, change scopes, request secrets, or recommend bypassing biometrics."; }
function freeze(value:any):ReviewSnapshot { return Object.freeze({...value,estimate:Object.freeze(value.estimate),audits:Object.freeze([...value.audits])}); }
