export const API_BASE=(process.env.EXPO_PUBLIC_YNX_AI_URL||"http://10.0.2.2:8096").replace(/\/$/,"");
export type Session={token:string;deviceId:string};
export type Conversation={id:string;title:string;archived:boolean;updatedAt:string;messageCount:number};
export type Message={id:string;role:"user"|"assistant";content:string;status:string;provider?:string;model?:string;cost?:{inputTokensEstimate:number;outputTokensEstimate:number;moneyUsdEstimate:number;moneyKnown:boolean}};
export type Attachment={id:string;name:string;mimeType:string;size:number;sha256:string};
export type Permission={id:string;scope:string;purpose:string;status:string;gatewayId?:string;expiresAt:string};
export type Usage={generations:number;inputTokensEstimate:number;outputTokensEstimate:number;resourceUnitsEstimate:number;moneyUsdEstimate:number;moneyKnown:boolean;actualUsageReported:boolean};

async function request<T>(path:string,init:RequestInit={},session?:Session):Promise<T>{
  const headers=new Headers(init.headers); headers.set("Accept","application/json");
  if(init.body) headers.set("Content-Type","application/json");
  if(session){headers.set("Authorization",`Bearer ${session.token}`);headers.set("X-YNX-Device-ID",session.deviceId);}
  let response:Response;
  try{response=await fetch(`${API_BASE}${path}`,{...init,headers});}catch{throw new Error("OFFLINE");}
  if(!response.ok){let detail="";try{detail=(await response.json()).error||"";}catch{} const error=new Error(detail||`HTTP_${response.status}`);(error as Error&{status?:number}).status=response.status;throw error;}
  return (response.status===204?undefined:await response.json()) as T;
}
export const api={
  createWalletRequest:(productDeviceKey:string)=>request<{request:unknown;requestDigest:string;walletUrl:string}>("/api/auth/wallet/requests",{method:"POST",body:JSON.stringify({productDeviceKey})}),
  approveWallet:(response:unknown)=>request<{challenge:import("./walletProtocol").GatewayChallenge}>("/api/auth/wallet/approvals",{method:"POST",body:JSON.stringify({response})}),
  completeWallet:(completion:unknown)=>request<{token:string;deviceId:string;account:string;scopes:string[]}>("/api/auth/wallet/sessions",{method:"POST",body:JSON.stringify(completion)}),
  conversations:(session:Session,archived=false)=>request<{conversations:Conversation[]}>(`/api/conversations?archived=${archived}`,{},session),
  createConversation:(session:Session,title:string)=>request<Conversation>("/api/conversations",{method:"POST",body:JSON.stringify({title})},session),
  conversation:(session:Session,id:string)=>request<{conversation:Conversation;messages:Message[]}>(`/api/conversations/${encodeURIComponent(id)}`,{},session),
  patchConversation:(session:Session,id:string,value:{title?:string;archived?:boolean})=>request<Conversation>(`/api/conversations/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(value)},session),
  deleteConversation:(session:Session,id:string)=>request<void>(`/api/conversations/${encodeURIComponent(id)}?confirm=delete`,{method:"DELETE"},session),
  provider:(session:Session)=>request<Record<string,unknown>>("/api/provider",{},session),
  usage:(session:Session)=>request<{usage:Usage;quotaKnown:boolean;quota:string;warning:string}>("/api/usage",{},session),
  permissions:(session:Session)=>request<{permissions:Permission[]}>("/api/permissions",{},session),
  actions:(session:Session)=>request<{actions:unknown[]}>("/api/actions",{},session),
  reviewAction:(session:Session,id:string,decision:"approve"|"reject",permissionGatewayId="")=>request<unknown>(`/api/actions/${encodeURIComponent(id)}/review`,{method:"POST",body:JSON.stringify({decision,permissionGatewayId})},session),
  audit:(session:Session)=>request<{audit:unknown[]}>("/api/audit",{},session),
  privacy:(session:Session)=>request<Record<string,unknown>>("/api/privacy",{},session),
  updatePrivacy:(session:Session,value:unknown)=>request<Record<string,unknown>>("/api/privacy",{method:"PUT",body:JSON.stringify(value)},session),
  deleteAll:(session:Session)=>request<void>("/api/privacy/data?confirm=delete-all",{method:"DELETE"},session),
  attachments:(session:Session,id:string)=>request<{attachments:Attachment[]}>(`/api/conversations/${encodeURIComponent(id)}/attachments`,{},session),
  addAttachment:(session:Session,id:string,value:{name:string;mimeType:string;contentBase64:string})=>request<Attachment>(`/api/conversations/${encodeURIComponent(id)}/attachments`,{method:"POST",body:JSON.stringify(value)},session),
  cancel:(session:Session,id:string)=>request<unknown>(`/api/generations/${encodeURIComponent(id)}/cancel`,{method:"POST"},session),
  revoke:(session:Session)=>request<void>("/api/auth/revoke",{method:"POST"},session)
};

export type StreamCallbacks={onMetadata:(value:unknown)=>void;onToken:(text:string)=>void;onDone:(value:unknown)=>void;onError:(error:Error)=>void};
export function streamGeneration(session:Session,conversationId:string,body:Record<string,unknown>,callbacks:StreamCallbacks){
  const xhr=new XMLHttpRequest();let cursor=0,pending="",terminal=false;
  const deliver=(block:string)=>{let event="",data="";for(const line of block.split("\n")){if(line.startsWith("event:"))event=line.slice(6).trim();else if(line.startsWith("data:"))data+=(data?"\n":"")+line.slice(5).trimStart();}if(!data)return;try{const value=JSON.parse(data);if(event==="token")callbacks.onToken(value.text||"");else if(event==="metadata")callbacks.onMetadata(value);else if(event==="done"){terminal=true;callbacks.onDone(value);}else if(event==="error"){terminal=true;callbacks.onError(new Error(value.error||"PROVIDER_UNAVAILABLE"));}}catch{}};
  const parse=()=>{pending+=xhr.responseText.slice(cursor);cursor=xhr.responseText.length;let boundary=pending.indexOf("\n\n");while(boundary>=0){deliver(pending.slice(0,boundary));pending=pending.slice(boundary+2);boundary=pending.indexOf("\n\n");}};
  xhr.open("POST",`${API_BASE}/api/conversations/${encodeURIComponent(conversationId)}/generate`);
  xhr.setRequestHeader("Authorization",`Bearer ${session.token}`);xhr.setRequestHeader("X-YNX-Device-ID",session.deviceId);xhr.setRequestHeader("Content-Type","application/json");xhr.onprogress=parse;xhr.onload=()=>{parse();if(pending.trim())deliver(pending);if(!terminal&&xhr.status>=400)callbacks.onError(Object.assign(new Error(xhr.responseText||`HTTP_${xhr.status}`),{status:xhr.status}));};xhr.onerror=()=>{if(!terminal)callbacks.onError(new Error("OFFLINE"));};xhr.ontimeout=()=>{if(!terminal)callbacks.onError(new Error("TIMEOUT"));};xhr.timeout=50000;xhr.send(JSON.stringify(body));
  return {abort:()=>xhr.abort()};
}
