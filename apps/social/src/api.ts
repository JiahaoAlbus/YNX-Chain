import type { ProductSessionChallenge, WalletApproval, WalletAuthorizationRequest, WalletLogin } from "./walletAuth";
import type { ChatDevice, ChatMessage, DeviceRotationRequest, SendMessageRequest } from "./chatCrypto";
export type Person = Readonly<{ id:string; handle:string; displayName:string; avatarUrl?:string }>;
export type ContactRequest = Readonly<{ id:string; person:Person; direction:"incoming"|"outgoing"; status:string; source:string }>;
export type ContactMatch = Readonly<{token:string;person:Person}>;
export type Conversation = Readonly<{ id:string; title:string; handle?:string; unread:number; lastMessage:string; e2ee:"verified"|"rotating"|"recovery-required"; updatedAt:string }>;
export type ConversationDetail = Conversation & Readonly<{members:readonly Person[]}>;
export type MediaObject = Readonly<{id:string;mimeType:string;sizeBytes:number;sha256:string;purpose:"moment"|"message";encrypted:boolean;createdAt:string}>;
export type FeedPost = Readonly<{ id:string; author:Person; text:string; media:readonly MediaObject[]; visibility:"public"|"contacts"|"private"; reactions:number; comments:number;viewerReaction?:"like"|"love"|"insight"|"support";status:string; createdAt:string }>;
export type MomentComment = Readonly<{id:string;author:Person;text:string;createdAt:string}>;
export type SocialReport = Readonly<{id:string;status:string;outcome:string;explanation:string;evidenceHashes:readonly string[];appeal?:string;updatedAt:string}>;
export type AlertItem = Readonly<{ id:string; kind:string; actor:Person; summary:string; readAt?:string; createdAt:string }>;
export type AIJob = Readonly<{id:string;status:"awaiting_permission"|"streaming"|"cancelled"|"provider_failed"|"review"|"applied"|"rejected"|"appealed";output?:string;provider:string;model:string;outputLanguage:string;estimatedCostUsd:number;actualCostUsd?:number;actualTokens?:number}>;
export type Session = Readonly<{ token:string; session:Readonly<{id:string;account:string;deviceId:string;scopes:readonly string[];createdAt:string;expiresAt:string}>; profile?:Person }>;
export type SocialProfile = Person & Readonly<{bio:string;followerCount:number;followingCount:number;postCount:number;privacy:Readonly<{discoverableByHandle:boolean;contactsMatching:boolean;allowRecommendations:boolean;allowRequestsFrom:string;avatarUrl?:string;profileQrPayload?:string}>}>;
export type PrivacySettings = SocialProfile["privacy"] & Readonly<{account?:string;updatedAt?:string}>;
export type GroupDiscoveryInput = Readonly<{ idempotencyKey: string; source: "handle" | "contacts" | "qr" | "invite" | "recommendation"; value: string }>;
export type GroupMembershipUpdateInput = Readonly<{ idempotencyKey: string; add: readonly GroupDiscoveryInput[]; remove: readonly string[] }>;
export type DeviceRotationResponse = Readonly<{record:{id:string};replayed:boolean;session:Session["session"];token:string}>;
export function adoptRotatedSession(previous:Session,result:DeviceRotationResponse):Session{return {...previous,token:result.token,session:result.session}}

export type SocialRuntimeVersion = Readonly<{
  service:"ynx-social";
  sourceCommit:string;
  releaseId:string;
  walletAuth:string;
  walletGateway:string;
  chainId:"ynx_6423-1";
  evmChainId:6423;
}>;
export type SocialAPIErrorCode =
  | "NETWORK_UNAVAILABLE"
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "API_NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_SERVER_RESPONSE"
  | "REQUEST_FAILED";
export class SocialAPIError extends Error {
  constructor(
    readonly code:SocialAPIErrorCode|string,
    message:string,
    readonly retryable:boolean,
    readonly status:number|null,
  ){super(message);this.name="SocialAPIError"}
}

export class SocialAPI {
  readonly base:string; private token:string|null;
  constructor(base=process.env.EXPO_PUBLIC_YNX_SOCIAL_API_BASE ?? "https://api.ynxweb4.com",token:string|null=null){if(!/^https:\/\//.test(base)&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))throw new Error("Set a secure YNX Social API endpoint");this.base=base.replace(/\/$/,"");this.token=token}
  setToken(value:string|null){this.token=value}
  useSession(value:Session){this.token=value.token}
  health(){return this.request<Record<string,unknown>>("/social/health",{auth:false})}
  version(){return this.request<SocialRuntimeVersion>("/social/version",{auth:false})}
  walletChallenge(request:WalletAuthorizationRequest,approval:WalletApproval){return this.request<{challenge:ProductSessionChallenge}>("/social/v1/wallet/challenge",{method:"POST",body:{request,approval},auth:false})}
  login(input:WalletLogin){return this.request<Session>("/social/v1/wallet/login",{method:"POST",body:input,auth:false})}
  profile(){return this.request<{record:SocialProfile}>("/social/v1/profile")}
  updateProfile(body:{idempotencyKey:string;handle:string;displayName:string;bio:string;avatarUrl?:string}){return this.request<{record:SocialProfile;replayed:boolean}>("/social/v1/profile",{method:"PUT",body})}
  settings(){return this.request<{record:PrivacySettings}>("/social/v1/settings")}
  updateSettings(body:{idempotencyKey:string;discoverableByHandle:boolean;contactsMatching:boolean;allowRecommendations:boolean;allowRequestsFrom:"everyone"|"contacts"|"nobody";avatarUrl?:string}){return this.request<{record:PrivacySettings;replayed:boolean}>("/social/v1/settings",{method:"PUT",body})}
  createInvite(ttlSeconds=86400){return this.request<{record:{link:string;expiresAt:string};token:string}>("/social/v1/invites",{method:"POST",body:{ttlSeconds}})}
  contacts(){return this.request<{contacts:Person[];requests:ContactRequest[]}>("/social/v1/contacts")}
  contactMatches(hashes:readonly string[]){return this.request<{matches:ContactMatch[]}>("/social/v1/contact-matches",{method:"POST",body:{hashes}})}
  requestContact(source:"handle"|"contacts"|"qr"|"invite"|"recommendation",value:string,idempotencyKey:string){return this.request("/social/v1/contact-requests",{method:"POST",body:{source,value,idempotencyKey}})}
  transitionRequest(id:string,action:"accept"|"reject"|"withdraw"){return this.request(`/social/v1/contact-requests/${encodeURIComponent(id)}`,{method:"POST",body:{action}})}
  deleteContact(target:string){return this.request("/social/v1/contacts/delete",{method:"POST",body:{target}})}
  block(target:string){return this.request("/social/v1/privacy/block",{method:"POST",body:{target}})}
  mute(target:string,active:boolean){return this.request("/social/v1/privacy/mute",{method:"POST",body:{target,active}})}
  conversations(query=""){return this.request<{conversations:Conversation[]}>(`/social/v1/conversations?q=${encodeURIComponent(query)}`)}
  createConversation(source:"handle"|"contacts"|"qr"|"invite"|"recommendation",value:string,idempotencyKey:string){return this.request<{record:{id:string};replayed:boolean}>("/social/v1/conversations",{method:"POST",body:{source,value,idempotencyKey}})}
  createGroup(title:string,handles:readonly string[],idempotencyKey:string){return this.request<{record:{id:string};replayed:boolean}>("/social/v1/conversations/groups",{method:"POST",body:{title,idempotencyKey,members:handles.map((value,index)=>({source:"handle",value,idempotencyKey:`member-${index}`}))}})}
  updateGroupMembers(id:string,body:GroupMembershipUpdateInput){return this.request<{record:ConversationDetail;replayed:boolean}>(`/social/v1/conversations/${encodeURIComponent(id)}/members`,{method:"POST",body})}
  conversation(id:string){return this.request<{record:ConversationDetail}>(`/social/v1/conversations/${encodeURIComponent(id)}`)}
  conversationDevices(id:string){return this.request<{devices:ChatDevice[]}>(`/social/v1/conversations/${encodeURIComponent(id)}/devices`)}
  messages(id:string){return this.request<{messages:ChatMessage[]}>(`/social/v1/conversations/${encodeURIComponent(id)}/messages`)}
  sendMessage(id:string,body:SendMessageRequest){return this.request<{record:ChatMessage;replayed:boolean}>(`/social/v1/conversations/${encodeURIComponent(id)}/messages`,{method:"POST",body})}
  acknowledge(id:string,messageId:string,state:"delivered"|"read"){return this.request<{record:ChatMessage}>(`/social/v1/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/${state}`,{method:"POST",body:{}})}
  rotateDevice(replacedDeviceId:string,body:DeviceRotationRequest){return this.request<DeviceRotationResponse>(`/social/v1/devices/${encodeURIComponent(replacedDeviceId)}/rotate`,{method:"POST",body})}
  feed(){return this.request<{posts:FeedPost[]}>("/social/v1/feed")}
  publishMoment(body:{idempotencyKey:string;text:string;visibility:"public"|"contacts"|"private";media:readonly string[]}){return this.request("/social/v1/feed",{method:"POST",body})}
  comments(id:string){return this.request<{comments:MomentComment[]}>(`/social/v1/feed/${encodeURIComponent(id)}/comments`)}
  comment(id:string,text:string,idempotencyKey:string){return this.request(`/social/v1/feed/${encodeURIComponent(id)}/comments`,{method:"POST",body:{text,idempotencyKey}})}
  react(id:string,kind:"like"|"love"|"insight"|"support",active:boolean,idempotencyKey:string){return this.request(`/social/v1/feed/${encodeURIComponent(id)}/reaction`,{method:"POST",body:{kind,active,idempotencyKey}})}
  deleteMoment(id:string){return this.request(`/social/v1/feed/${encodeURIComponent(id)}`,{method:"DELETE",headers:{"X-YNX-Confirm-Delete":"DELETE MOMENT"}})}
  follow(handle:string,active:boolean,idempotencyKey:string){return this.request("/social/v1/follows",{method:"POST",body:{source:"handle",value:handle,idempotencyKey,active}})}
  uploadMedia(body:{idempotencyKey:string;purpose:"moment"|"message";conversationId?:string;mimeType:string;sha256:string;data:string}){return this.request<{record:MediaObject;replayed:boolean}>("/social/v1/media",{method:"POST",body})}
  mediaSource(id:string){if(!this.token)throw new Error("Social session is locked");return {uri:`${this.base}/social/v1/media/${encodeURIComponent(id)}`,headers:{Authorization:`Bearer ${this.token}`}}}
  async downloadMedia(id:string){if(!this.token)throw new Error("Social session is locked");const response=await fetch(`${this.base}/social/v1/media/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${this.token}`}});if(!response.ok)throw new Error(`Attachment download failed (${response.status})`);return new Uint8Array(await response.arrayBuffer())}
  report(body:{idempotencyKey:string;targetType:string;targetId:string;category:string;detail:string;evidenceHashes:readonly string[]}){return this.request<{record:SocialReport;replayed:boolean}>("/social/v1/reports",{method:"POST",body})}
  reportDetail(id:string){return this.request<{record:SocialReport}>(`/social/v1/reports/${encodeURIComponent(id)}`)}
  appealReport(id:string,correction:string){return this.request<{record:SocialReport}>(`/social/v1/reports/${encodeURIComponent(id)}/appeal`,{method:"POST",body:{correction}})}
  alerts(){return this.request<{notifications:AlertItem[];unread:number}>("/social/v1/notifications")}
  markRead(id:string){return this.request(`/social/v1/notifications/${encodeURIComponent(id)}/read`,{method:"POST",body:{}})}
  exportData(){return this.request<Record<string,unknown>>("/social/v1/privacy/export")}
  deleteAccount(){return this.request("/social/v1/privacy/delete",{method:"DELETE",headers:{"X-YNX-Confirm-Delete":"DELETE MY SOCIAL DATA"}})}
  aiBegin(body:Record<string,unknown>){return this.request<{record:AIJob;replayed:boolean}>("/social/v1/ai/jobs",{method:"POST",body})}
  aiTransition(id:string,action:string,output=""){return this.request<AIJob>(`/social/v1/ai/jobs/${encodeURIComponent(id)}`,{method:"POST",body:{action,output}})}
  async streamAI(id:string,contextText:string,onToken:(value:string)=>void,signal?:AbortSignal):Promise<AIJob>{if(!this.token)throw new Error("Social session is locked");const response=await fetch(`${this.base}/social/v1/ai/jobs/${encodeURIComponent(id)}/stream`,{method:"POST",headers:{Accept:"text/event-stream","Content-Type":"application/json",Authorization:`Bearer ${this.token}`},body:JSON.stringify({contextText}),signal});if(!response.ok)throw new Error(`Social AI stream failed (${response.status})`);if(!response.body)throw new Error("Streaming is unavailable on this device");const reader=response.body.getReader(),decoder=new TextDecoder(),lines:{event:string;data:string}[]=[];let buffer="",event="",doneJob:AIJob|undefined;while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});const parts=buffer.split("\n");buffer=parts.pop()??"";for(const raw of parts){const line=raw.trimEnd();if(line.startsWith("event:")){event=line.slice(6).trim()}else if(line.startsWith("data:")){const data=line.slice(5).trim();lines.push({event,data});if(event==="token"){const value=JSON.parse(data) as {text?:string};if(value.text)onToken(value.text)}else if(event==="error"){const value=JSON.parse(data) as {error?:string};throw new Error(value.error??"AI provider unavailable")}else if(event==="done"){const value=JSON.parse(data) as {record?:AIJob};doneJob=value.record}}}}if(!doneJob)throw new Error("AI stream ended before review state");return doneJob}
  async request<T=unknown>(path:string,options:{method?:string;body?:unknown;auth?:boolean;headers?:Record<string,string>}={}):Promise<T>{
    const method=options.method??"GET",headers:Record<string,string>={Accept:"application/json",...options.headers};
    if(options.body!==undefined)headers["Content-Type"]="application/json";
    if(options.auth!==false){if(!this.token)throw new SocialAPIError("AUTH_REQUIRED","Social session is locked",false,null);headers.Authorization=`Bearer ${this.token}`}
    const body=options.body===undefined?undefined:JSON.stringify(options.body),maxAttempts=method==="GET"?2:1;
    for(let attempt=0;attempt<maxAttempts;attempt+=1){
      let response:Response;
      try{response=await fetch(`${this.base}${path}`,{method,headers,body})}
      catch{
        if(attempt+1<maxAttempts){await retryDelay();continue}
        throw new SocialAPIError("NETWORK_UNAVAILABLE","Social service could not be reached. Check the connection and try again.",true,null)
      }
      const data=await response.json().catch(()=>null) as null|Record<string,unknown>;
      if(response.ok){if(data===null)throw new SocialAPIError("INVALID_SERVER_RESPONSE","Social service returned an invalid response",false,response.status);return data as T}
      const serverCode=typeof data?.code==="string"&&/^[A-Z][A-Z0-9_]{2,63}$/.test(data.code)?data.code:null;
      const serverRetryable=typeof data?.retryable==="boolean"?data.retryable:undefined;
      const retryable=serverRetryable??[429,502,503,504].includes(response.status);
      if(retryable&&attempt+1<maxAttempts){await retryDelay();continue}
      const code=serverCode??httpErrorCode(response.status);
      const safeMessage=typeof data?.error==="string"&&data.error.length<=240?data.error:`Social request failed (${response.status})`;
      throw new SocialAPIError(code,safeMessage,retryable,response.status)
    }
    throw new SocialAPIError("REQUEST_FAILED","Social request failed",false,null)
  }
}

function httpErrorCode(status:number):SocialAPIErrorCode{
  if(status===401)return "AUTH_REQUIRED";
  if(status===403)return "ACCESS_DENIED";
  if(status===404)return "API_NOT_FOUND";
  if(status===409)return "CONFLICT";
  if(status===429)return "RATE_LIMITED";
  if(status===502||status===503||status===504)return "SERVICE_UNAVAILABLE";
  return "REQUEST_FAILED";
}
const retryDelay=()=>new Promise<void>((resolve)=>setTimeout(resolve,150));
