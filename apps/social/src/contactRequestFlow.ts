import {ContactOperation} from "./contactOperation";
import type {SocialAPI,Person,GroupDiscoveryInput} from "./api";

export type ContactReview=Readonly<{source:GroupDiscoveryInput["source"];value:string;person:Person;idempotencyKey:string}>;
export type SocialDiscoveryEntry=Readonly<{source:'qr'|'invite';value:string}>;
// URL input is an untrusted business intent, never a session callback or grant.
export function socialDiscoveryEntry(value:unknown):SocialDiscoveryEntry|null{
 if(typeof value!=='string'||value.length>256)return null;
 const match=/^https:\/\/social\.ynxweb4\.com\/(people\/sp_[A-Za-z0-9_-]{32}|invite\/[A-Za-z0-9_-]{32})$/.exec(value);
 return match?Object.freeze({source:match[1]!.startsWith('people/')?'qr':'invite',value}):null;
}

export function socialProfileQR(value:unknown):string|null{
  if(typeof value!=="string"||value.length>512)return null;
  try{const url=new URL(value);if(url.origin!=="https://social.ynxweb4.com"||url.username||url.password||url.search||url.hash||!/^\/people\/sp_[A-Za-z0-9_-]{32}$/.test(url.pathname)||url.href!==value)return null;return value}catch{return null}
}
export function requireSocialProfileQR(value:string):string{
  if(value.startsWith("ynxsocial://profile/"))throw new Error("This is a legacy username QR. Ask the person to refresh their stable Social QR.");
  const qr=socialProfileQR(value);if(!qr)throw new Error("This is not a canonical stable Social profile QR");return qr;
}

// Native/Web UI consumer; live permissions remain exclusively the API authority.
export class ContactRequestFlow{
  private sequence=0;private review:ContactReview|null=null;private guard:(()=>boolean)|null=null;private readonly operation=new ContactOperation();private uncertain:Array<{review:ContactReview;message:string;guard:()=>boolean}>=[];private message:string|null=null;
  constructor(private api:SocialAPI,private randomId:()=>Promise<string>){}
  cancel(){this.operation.cancel();this.sequence++;this.review=null;this.guard=null;this.message=null}
  get uncertainRequests(){this.uncertain=this.uncertain.filter(item=>item.guard());return this.uncertain.map(({review,message})=>({review,message}))}
  isCurrent(review:ContactReview){return this.review===review&&!!this.guard?.()}
  async preview(source:ContactReview["source"],input:string):Promise<ContactReview>{
    this.cancel();const sequence=this.sequence,guard=this.api.authorizationGuard();let value=input.trim();
    if(source==="handle"||source==="recommendation")value=value.replace(/^@/,"");
    if(/^ynx1/i.test(value))throw new Error("Wallet addresses cannot be used to add friends");
    if(source==="qr")value=requireSocialProfileQR(value);
    if(source==='invite'){
      if(value.startsWith('https:')){const entry=socialDiscoveryEntry(value);if(!entry||entry.source!=='invite')throw new Error('Use an exact YNX Social invitation link');value=value.slice('https://social.ynxweb4.com/invite/'.length)}
      if(!/^[A-Za-z0-9_-]{32}$/.test(value))throw new Error('Use an exact YNX Social invitation link');
    }
    if(!value||value.length>2048)throw new Error("Enter a valid person discovery value");
    const result=await this.operation.run(()=>this.api.previewContact(source,value));
    if(sequence!==this.sequence||!guard())throw new Error("Social authorization changed; review the person again");
    if(!/^sp_[A-Za-z0-9_-]{32}$/.test(result.person?.id??"")||typeof result.person.handle!=="string"||typeof result.person.displayName!=="string")throw new Error("A stable Social profile could not be verified");
    if(source==='qr'&&result.person.id!==value.slice('https://social.ynxweb4.com/people/'.length))throw new Error('The original personal code does not match this profile');
    const entropy=await this.operation.run(()=>this.randomId());if(sequence!==this.sequence||!guard())throw new Error("Social authorization changed; old preview discarded");
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(entropy))throw new Error("Request identity could not be created");
    const review=Object.freeze({source,value,person:Object.freeze({...result.person}),idempotencyKey:`native-contact-${entropy}`});this.review=review;this.guard=guard;return review;
  }
  async confirm(review:ContactReview,message=""){
    if(!this.isCurrent(review))throw new Error("Review this person again before sending");
    message=message.trim();if(Array.from(message).length>200)throw new Error("Keep the request message within 200 characters");
    if(this.message!==null&&this.message!==message)throw new Error("Retry the original message or review the person again");this.message=message;const intent={review,message,guard:this.guard!};
    try{await this.operation.run(()=>this.api.requestContact(review.source,review.value,review.idempotencyKey,review.person.id,message));if(!this.isCurrent(review))throw new Error("Social authorization changed; the old result was discarded");this.uncertain=this.uncertain.filter(item=>item.review!==review);this.cancel()}catch(error){if(intent.guard()&&!this.uncertain.some(item=>item.review===review))this.uncertain.push(intent);throw error}
  }
}
