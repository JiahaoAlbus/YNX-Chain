import type {SocialAPI,Person,GroupDiscoveryInput} from "./api";

export type ContactReview=Readonly<{source:GroupDiscoveryInput["source"];value:string;person:Person;idempotencyKey:string}>;

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
  private sequence=0;private review:ContactReview|null=null;private guard:(()=>boolean)|null=null;private sending=false;private message:string|null=null;
  constructor(private api:SocialAPI,private randomId:()=>Promise<string>){}
  cancel(){this.sequence++;this.review=null;this.guard=null;this.message=null}
  isCurrent(review:ContactReview){return this.review===review&&!!this.guard?.()}
  async preview(source:ContactReview["source"],input:string):Promise<ContactReview>{
    this.cancel();const sequence=this.sequence,guard=this.api.authorizationGuard();let value=input.trim();
    if(source==="handle"||source==="recommendation")value=value.replace(/^@/,"");
    if(/^ynx1/i.test(value))throw new Error("Wallet addresses cannot be used to add friends");
    if(source==="qr")value=requireSocialProfileQR(value);
    if(source==="invite"&&value.startsWith("https:")){const link=new URL(value);if(link.origin!=="https://social.ynxweb4.com"||link.username||link.password||link.search||link.hash||!/^\/invite\/[A-Za-z0-9_-]+$/.test(link.pathname))throw new Error("Use an exact YNX Social invitation link");value=link.pathname.slice("/invite/".length)}
    if(!value||value.length>2048)throw new Error("Enter a valid person discovery value");
    const result=await this.api.previewContact(source,value);
    if(sequence!==this.sequence||!guard())throw new Error("Social authorization changed; review the person again");
    if(!/^sp_[A-Za-z0-9_-]{32}$/.test(result.person?.id??"")||typeof result.person.handle!=="string"||typeof result.person.displayName!=="string")throw new Error("A stable Social profile could not be verified");
    const entropy=await this.randomId();if(sequence!==this.sequence||!guard())throw new Error("Social authorization changed; old preview discarded");
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(entropy))throw new Error("Request identity could not be created");
    const review=Object.freeze({source,value,person:Object.freeze({...result.person}),idempotencyKey:`native-contact-${entropy}`});this.review=review;this.guard=guard;return review;
  }
  async confirm(review:ContactReview,message=""){
    if(!this.isCurrent(review))throw new Error("Review this person again before sending");if(this.sending)throw new Error("A contact request is already being sent");
    message=message.trim();if(Array.from(message).length>200)throw new Error("Keep the request message within 200 characters");
    if(this.message!==null&&this.message!==message)throw new Error("Retry the original message or review the person again");this.message=message;this.sending=true;
    try{await this.api.requestContact(review.source,review.value,review.idempotencyKey,review.person.id,message);if(!this.isCurrent(review))throw new Error("Social authorization changed; the old result was discarded");this.cancel()}finally{this.sending=false}
  }
}
