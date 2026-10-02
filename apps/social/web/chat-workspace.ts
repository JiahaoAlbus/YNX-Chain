import {SocialAPI,type Session,type SocialProfile,type PrivacySettings,type Invitation,type Conversation,type Person,type ContactRequest} from "../src/api";
import {checkedInvitationSnapshot,type InvitationIntent,type InvitationIntentStore} from '../src/invitationIntent';
import {checkedPrivacySettings} from '../src/privacySettings';
import {ContactOperation} from '../src/contactOperation';
import {bindScopedSocialSession,type StoredChatDevice,type ScopedSessionClient} from "../src/scopedSessionBridge";
import {createEnvelopeSet,decryptDeviceMessage,verifyMessageSignature,type ChatMessage} from "../src/chatCrypto";
import {DurableOutbox} from "../src/durableOutbox";
import {queueMessage,acknowledgeQueued,pendingFor,assertPendingRecipients} from "../src/messageOutbox";
import {bytesToHex,hexToBytes} from "@noble/hashes/utils.js";
import {protectedChatDevices,indexedDBChatCarriers} from "./protected-chat-devices";

type PrivateClient=ScopedSessionClient&{restore():Promise<any>;handleReturn(url:string):Promise<any>;begin():Promise<any>;disconnect():Promise<any>};
type View={status:string;account?:string;profile?:SocialProfile;settings?:PrivacySettings;invitations?:Invitation[];invitationPending?:boolean;needsProfileSetup?:boolean;contacts?:Person[];requests?:ContactRequest[];conversations?:Conversation[];conversationId?:string;messages?:{record:ChatMessage;plaintext:string}[]};
type DeviceStore={get(account:string,create:boolean):Promise<StoredChatDevice>;protectLegacy?(account:string,confirmed:boolean):Promise<StoredChatDevice>};
export type ContactPreview=Readonly<{source:"handle"|"qr"|"invite";value:string;person:Person;idempotencyKey:string}>;
export function browserChatDevices(environment:typeof globalThis=globalThis):DeviceStore{
  return protectedChatDevices(indexedDBChatCarriers(environment.indexedDB),environment);
}

export class SocialWorkspace{
  private session:Session|null=null;private device:StoredChatDevice|null=null;private generation=0;
  private contactPreview:ContactPreview|null=null;private previewSequence=0;private submittingPreview:ContactPreview|null=null;
  private contactMessage:{preview:ContactPreview;message:string}|null=null;
  private readonly privacyOperation=new ContactOperation();
  private readonly invitationOperation=new ContactOperation();
  private privacyIntent:{generation:number;body:Parameters<SocialAPI['updateSettings']>[0]}|null=null;
  private view:View={status:"Private workspace is locked"};
  constructor(private readonly client:PrivateClient,private readonly api:SocialAPI,private readonly devices:DeviceStore,private readonly outbox:DurableOutbox,private readonly identity:()=>Promise<{account:string;csrfToken:string}>,private readonly publish:(view:View)=>void,private readonly random:(bytes:Uint8Array)=>Uint8Array=bytes=>{bytes.set(crypto.getRandomValues(new Uint8Array(bytes.length)));return bytes},private readonly invitationIntents?:InvitationIntentStore){}
  get current(){return this.view}
  lock(status="Private workspace is locked"){this.invitationOperation.cancel();this.privacyOperation.cancel();this.privacyIntent=null;this.generation++;this.previewSequence++;this.contactPreview=null;this.contactMessage=null;this.submittingPreview=null;this.session=null;this.device=null;this.api.setToken(null);this.view={status};this.publish(this.view)}
  private render(next:Partial<View>,generation=this.generation){if(generation!==this.generation)throw new Error("Social account changed; old data discarded");this.view={...this.view,...next};this.publish(this.view)}
  private active(){if(!this.session||!this.device)throw new Error("Explicit Social chat approval is required");return {session:this.session,device:this.device,generation:this.generation}}
  async authorize(){this.lock("Waiting for your explicit Social chat permission");return this.client.begin()}
  async connect(result:any,create=false){
    this.lock("Verifying identity, Social permission and chat device");const generation=this.generation;
    if(result.status!=="connected"||!["social.contacts","social.messaging","social.profile"].every(scope=>result.session?.scopes?.includes(scope)))throw new Error("Profile, contacts and encrypted chat require your explicit approval");
    const identity=await this.identity();if(identity.account!==result.session.account)throw new Error("Shared identity and Social permission differ; reconnect explicitly");
    const device=await this.devices.get(identity.account,create);if(generation!==this.generation)throw new Error("Social account changed");
    const session=await bindScopedSocialSession(this.api,this.client,device,identity.csrfToken);
    if(generation!==this.generation){this.api.setToken(null);throw new Error("Social account changed")}
    this.session=session;this.device=device;this.render({account:session.session.account,conversations:[],messages:[],status:"Profile and encrypted chat verified on this device"},generation);
    await this.refresh();return session;
  }
  async restore(){try{return await this.connect(await this.client.restore())}catch(error){this.lock("Saved workspace is unavailable. Keys and pending ciphertext were retained.");throw error}}
  async accept(url:string){try{return await this.connect(await this.client.handleReturn(url),true)}catch(error){this.lock("Social approval could not be verified; no private workspace unlocked");throw error}}
  async protectExistingDevice(confirmed:boolean){
    this.lock("Existing browser device protection requires confirmation");
    const result=await this.client.restore();
    if(result.status!=="connected"||!result.session?.scopes?.includes("social.messaging"))throw new Error("Restore your approved Social session before protecting its device");
    const identity=await this.identity();if(identity.account!==result.session.account||!this.devices.protectLegacy)throw new Error("No matching device protection operation");
    await this.devices.protectLegacy(identity.account,confirmed);return this.connect(result);
  }
  async logout(){this.lock("Signed out locally; server revocation is pending");const result=await this.client.disconnect();if(result.status!=="disconnected")throw new Error("Social revocation is pending; private access remains locked");this.lock("Social permission revoked. Keys and pending ciphertext retained.")}
  async refresh(){const {generation}=this.active();const [profile,conversations,people]=await Promise.all([this.api.profileOrSetup(),this.api.conversations(),this.api.contacts()]);this.render({profile:profile??undefined,needsProfileSetup:!profile,contacts:people.contacts,requests:people.requests,conversations:conversations.conversations,status:profile?"Workspace refreshed":"Create your profile and handle to start connecting with people"},generation);const selected=this.view.conversationId;if(selected){if(conversations.conversations.some(item=>item.id===selected))await this.select(selected);else this.render({conversationId:undefined,messages:[]},generation)}}
  async updateProfile(body:{handle:string;displayName:string;bio:string}){const {generation}=this.active();const result=await this.api.updateProfile({...body,idempotencyKey:`profile-${bytesToHex(this.random(new Uint8Array(12)))}`});this.render({profile:result.record,needsProfileSetup:false,status:"Profile saved"},generation);await this.refresh()}
  async loadPrivacy(){
    const {session,generation}=this.active();const result=await this.privacyOperation.run(signal=>this.api.settings(signal));
    if(generation!==this.generation)throw new Error("Social account changed; old privacy settings discarded");
    const settings=checkedPrivacySettings(result.record,session.session.account);this.privacyIntent=null;this.render({settings,status:"Current discovery privacy loaded. No address book was uploaded."},generation);
  }
  async savePrivacy(input:{discoverableByHandle:boolean;contactsMatching:boolean;allowRecommendations:boolean;allowRequestsFrom:"everyone"|"contacts"|"nobody"}){
    const {session,generation}=this.active();if(!this.view.settings)throw new Error("Read your current privacy settings first");
    const body={...input,avatarUrl:this.view.settings.avatarUrl};
    const previous=this.privacyIntent;
    if(previous&&JSON.stringify({...previous.body,idempotencyKey:undefined})!==JSON.stringify(body))throw new Error("Retry the original unchanged privacy settings or read the current server settings first");
    const intent=previous??{generation,body:{...body,idempotencyKey:`privacy-${bytesToHex(this.random(new Uint8Array(12)))}`}};this.privacyIntent=intent;
    const result=await this.privacyOperation.run(signal=>this.api.updateSettings(intent.body,signal));
    if(generation!==this.generation||this.privacyIntent!==intent)throw new Error("Social account changed; old privacy result discarded");
    const settings=checkedPrivacySettings(result.record,session.session.account);this.privacyIntent=null;
    this.render({settings,profile:this.view.profile?{...this.view.profile,privacy:settings}:undefined,status:"Discovery privacy saved. No contact upload, following or wallet request was made."},generation);
  }
  async loadInvitations(){
    const {session,generation}=this.active(),account=session.session.account;
    const guard=()=>{if(generation!==this.generation)throw new Error('Social account changed; old invitation readback discarded')};
    await this.invitationOperation.run(async signal=>{
      const intent=await this.invitationIntents?.load(account);guard();
      const result=checkedInvitationSnapshot(await this.api.invitations(intent?.key,signal));guard();
      if(intent&&result.operation?.confirmed){await this.invitationIntents!.clear(account,intent.key,guard,signal);guard()}
      this.render({invitations:result.invitations,invitationPending:!!intent&&!result.operation?.confirmed,status:intent&&!result.operation?.confirmed?'Original invitation outcome is not confirmed. Retry keeps the same request identity.':'Invitations read from your current private account. Sharing never adds contacts or followers.'},generation);
    });
  }
  async createInvitation(){
    const {session,generation}=this.active(),account=session.session.account;if(!this.view.profile||!this.invitationIntents)throw new Error('An existing profile and durable invitation storage are required');
    const guard=()=>{if(generation!==this.generation)throw new Error('Social account changed; original invitation intent retained')};
    await this.invitationOperation.run(async signal=>{
      let intent=await this.invitationIntents!.load(account);guard();
      if(!intent){const candidate:InvitationIntent={schemaVersion:1,account,key:`invitation-${bytesToHex(this.random(new Uint8Array(12)))}`,ttlSeconds:86400};intent=await this.invitationIntents!.reserve(candidate,guard,signal);guard()}
      this.render({invitationPending:true,status:'Creating or retrying your original invitation. The outcome must be read back.'},generation);
      const created=await this.api.createInvite(intent.ttlSeconds,intent.key,signal);guard();
      const result=checkedInvitationSnapshot(await this.api.invitations(intent.key,signal));guard();
      if(!result.operation?.confirmed||result.operation.id!==created.record.id)throw new Error('Original invitation was not confirmed; its exact request identity is retained');
      await this.invitationIntents!.clear(account,intent.key,guard,signal);guard();
      this.render({invitations:result.invitations,invitationPending:false,status:'Original invitation confirmed. The recipient must preview your profile and you must accept their request.'},generation);
    });
  }
  async revokeInvitation(id:string){
    const {generation}=this.active();if(!this.view.invitations?.some(record=>record.id===id&&record.status==='active'))throw new Error('Choose a current active invitation first');
    await this.invitationOperation.run(signal=>this.api.revokeInvite(id,signal));if(generation!==this.generation)throw new Error('Social account changed; old revocation result discarded');await this.loadInvitations();
  }
  async previewContact(source:ContactPreview["source"],input:string):Promise<ContactPreview>{
    const {generation}=this.active();if(!this.view.profile)throw new Error("Create your profile before sending a contact request");
    const sequence=++this.previewSequence;this.contactPreview=null;this.contactMessage=null;
    let value=input.trim();if(source==="handle")value=value.replace(/^@/,"");
    if(source==="invite"&&value.startsWith("https:")){const url=new URL(value);if(url.origin!=="https://social.ynxweb4.com"||url.username||url.password||url.search||url.hash||!/^\/invite\/[A-Za-z0-9_-]+$/.test(url.pathname))throw new Error("Use an exact YNX Social invitation link");value=url.pathname.slice("/invite/".length)}
    if(!value)throw new Error("Enter the person's username, QR content or invitation");
    const result=await this.api.previewContact(source,value);
    if(generation!==this.generation||sequence!==this.previewSequence)throw new Error("Contact preview changed; review again");
    if(!result.person?.id||typeof result.person.handle!=="string"||typeof result.person.displayName!=="string")throw new Error("Contact profile could not be verified");
    const preview=Object.freeze({source,value,person:Object.freeze({...result.person}),idempotencyKey:`contact-${bytesToHex(this.random(new Uint8Array(12)))}`});
    this.contactPreview=preview;return preview;
  }
  isContactPreviewCurrent(preview:ContactPreview){return !!this.session&&!!this.device&&this.contactPreview===preview}
  contactContextGuard(){const {generation}=this.active();return()=>generation===this.generation&&!!this.session&&!!this.device}
  cancelContactPreview(preview:ContactPreview){if(this.contactPreview===preview){this.contactPreview=null;this.contactMessage=null;this.previewSequence++}}
  async confirmContact(preview:ContactPreview,message=""){
    const {generation}=this.active();if(!this.isContactPreviewCurrent(preview))throw new Error("Contact preview changed; review again");
    if(this.submittingPreview)throw new Error("A contact request is already being submitted");
    message=message.trim();if(Array.from(message).length>200)throw new Error("Keep the request message within 200 characters");
    if(this.contactMessage?.preview===preview&&this.contactMessage.message!==message)throw new Error("Retry the original request message or review again");
    this.contactMessage={preview,message};
    this.submittingPreview=preview;
    try{await this.api.requestContact(preview.source,preview.value,preview.idempotencyKey,preview.person.id,message);if(generation!==this.generation)throw new Error("Social account changed; old request result discarded");this.cancelContactPreview(preview);await this.refresh()}finally{if(this.submittingPreview===preview)this.submittingPreview=null}
  }
  async requestContact(handle:string,preview?:ContactPreview){if(!preview||preview.source!=="handle"||preview.value!==handle.trim().replace(/^@/,""))throw new Error("Preview the person and explicitly confirm before sending a request");return this.confirmContact(preview)}
  async transitionContact(id:string,action:"accept"|"reject"|"withdraw"){this.active();await this.api.transitionRequest(id,action);await this.refresh()}
  async changeContact(id:string,action:"remove"|"block"|"mute"|"unmute"){
    const {generation}=this.active();
    if(!/^sp_[A-Za-z0-9_-]{32}$/.test(id)||!this.view.contacts?.some(person=>person.id===id))throw new Error("Choose a current accepted contact first");
    if(action==="remove")await this.api.deleteContact(id);
    else if(action==="block")await this.api.block(id);
    else await this.api.mute(id,action==="mute");
    if(generation!==this.generation)throw new Error("Social account changed; old contact result discarded");
    await this.refresh();
  }
  async createConversation(handle:string){this.active();const normalized=handle.trim().replace(/^@/,"");if(!this.view.contacts?.some(person=>person.handle===normalized))throw new Error("Ask the person to accept your contact request before starting a conversation");const result=await this.api.createConversation("handle",normalized,`conversation-${bytesToHex(this.random(new Uint8Array(12)))}`);await this.refresh();await this.select(result.record.id)}
  async select(id:string){
    const {device,generation}=this.active();const [devices,page]=await Promise.all([this.api.conversationDevices(id),this.api.messages(id)]);
    const seed=hexToBytes(device.encryptionSeed);
    try{const messages=page.messages.map(record=>{const sender=devices.devices.find(item=>item.id===record.senderDeviceId);if(!sender||sender.account!==record.sender||!verifyMessageSignature(record,sender))throw new Error("Message sender verification failed");return {record,plaintext:record.envelopes.some(item=>item.recipientDeviceId===device.deviceId)?decryptDeviceMessage({encryptionSeed:seed,deviceId:device.deviceId,message:record}):"This earlier message was encrypted for another device. Its original ciphertext is preserved."}});this.render({conversationId:id,messages,status:"Verified encrypted message history"},generation)}finally{seed.fill(0)}
  }
  async send(text:string){
    const {session,device,generation}=this.active(),id=this.view.conversationId;if(!id)throw new Error("Choose a conversation first");
    if(pendingFor(this.outbox.read(),session.session.account,device.deviceId,id))throw new Error("Retry the retained encrypted message before creating another");
    const devices=await this.api.conversationDevices(id);if(generation!==this.generation)throw new Error("Social account changed");const signing=hexToBytes(device.signingSeed),entropy=this.random(new Uint8Array(32));
    try{const request=createEnvelopeSet({signingSeed:signing,senderAccount:session.session.account,senderDeviceId:device.deviceId,conversationId:id,messageId:`message-${bytesToHex(this.random(new Uint8Array(12)))}`,plaintext:text,devices:devices.devices,entropy});this.outbox.update(entries=>queueMessage(entries,{account:session.session.account,deviceId:device.deviceId,conversationId:id,request}))}finally{signing.fill(0);entropy.fill(0)}
    await this.retry();
  }
  async retry(){const {session,device,generation}=this.active(),id=this.view.conversationId;if(!id)throw new Error("Choose a conversation first");const request=pendingFor(this.outbox.read(),session.session.account,device.deviceId,id);if(!request)throw new Error("No retained encrypted message for this account and device");const pending={account:session.session.account,deviceId:device.deviceId,conversationId:id,request};const devices=await this.api.conversationDevices(id);assertPendingRecipients(pending,devices.devices);if(generation!==this.generation)throw new Error("Social account changed");await this.api.sendMessage(id,request);if(generation!==this.generation)throw new Error("Social account changed; pending ciphertext retained");this.outbox.update(entries=>acknowledgeQueued(entries,pending));await this.select(id)}
}
