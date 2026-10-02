import {decodeBase64,encodeBase64} from 'matrix-encrypt-attachment';
import {createBoundedOperation,wipeBytes} from './bounded-operation.mjs';
export const RESTRICTED_MOMENT_PROTOCOL = 'ynx-social-matrix-moment/v1';
const deny = message => { throw new Error(message); };
function snapshot(value) {
  if (!value || value.protocol !== RESTRICTED_MOMENT_PROTOCOL ||
      !['contacts','group','selected','private'].includes(value.kind) ||
      typeof value.revision !== 'string' || !value.revision || value.revision.length > 256 ||
      typeof value.owner !== 'string' || !value.owner.startsWith('@') ||
      typeof value.roomId !== 'string' || !value.roomId.startsWith('!') ||
      !Array.isArray(value.members) || !value.members.length || value.members.length > 256 ||
      value.members.some(member => typeof member !== 'string' || !member.startsWith('@')) ||
      new Set(value.members).size !== value.members.length || !value.members.includes(value.owner) ||
      (value.kind === 'private' && value.members.length !== 1)) deny('Verified restricted audience required');
  return Object.freeze({protocol:value.protocol,kind:value.kind,revision:value.revision,
    owner:value.owner,roomId:value.roomId,members:Object.freeze([...value.members].sort())});
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const orderedJSON=value=>Array.isArray(value)?value.map(orderedJSON):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,orderedJSON(value[key])])):value;
const sameJSON=(actual,expected)=>JSON.stringify(orderedJSON(actual))===JSON.stringify(orderedJSON(expected));
const sameTypedFields=(actual,expected)=>{
  if(actual===undefined||expected===undefined)return actual===expected;
  if(!actual||typeof actual!=='object'||Array.isArray(actual))return false;
  const keys=Object.keys(expected).sort();
  return JSON.stringify(Object.keys(actual).sort())===JSON.stringify(keys)&&
    keys.every(key=>typeof actual[key]===typeof expected[key]&&actual[key]===expected[key]);
};
const canonicalBytes=(value,length,url=false)=>{
  if(typeof value!=='string'||!(url?/^[A-Za-z0-9_-]+$/:/^[A-Za-z0-9+/]+$/).test(value))return false;
  try{
    const bytes=decodeBase64(url?value.replace(/-/g,'+').replace(/_/g,'/'):value);
    const encoded=encodeBase64(bytes).replace(/=+$/,'');
    return bytes.byteLength===length&&(url?encoded.replace(/\+/g,'-').replace(/\//g,'_'):encoded)===value;
  }catch{return false}
};
// Official Matrix descriptor/base64 primitives; no new encryption algorithm.
// info is optional for Matrix reads; the existing YNX uploader requires it.
const validAttachment=(attachment,requireInfo=true)=>{
  const file=attachment?.file;
  const info=attachment?.info;
  const infoValid=requireInfo?Number.isSafeInteger(info?.size)&&info.size>=1&&info.size<=25*1024*1024&&typeof info.mimetype==='string':
    info===undefined||!!info&&typeof info==='object'&&!Array.isArray(info)&&(info.size===undefined||Number.isSafeInteger(info.size)&&info.size>=1&&info.size<=25*1024*1024)&&(info.mimetype===undefined||typeof info.mimetype==='string');
  return attachment?.msgtype==='m.file'&&attachment.url===undefined&&typeof attachment.body==='string'&&!!attachment.body&&attachment.body.length<=255&&
    !!file&&file.v==='v2'&&typeof file.url==='string'&&/^mxc:\/\/[^\s/?#]+\/[^\s/?#]+$/.test(file.url)&&
    canonicalBytes(file.iv,16)&&canonicalBytes(file.hashes?.sha256,32)&&
    file.key?.kty==='oct'&&file.key.alg==='A256CTR'&&file.key.ext===true&&Array.isArray(file.key.key_ops)&&file.key.key_ops.every(op=>typeof op==='string')&&file.key.key_ops.includes('encrypt')&&file.key.key_ops.includes('decrypt')&&canonicalBytes(file.key.k,32,true)&&infoValid;
};
export {validAttachment as validEncryptedAttachment};

// authorize is supplied by the actual approved backend integration, never by
// a follow list or assertTrusted. No endpoint or consent scope is invented here.
export class RestrictedMoments {
  constructor({transport,authorize}) {
    if (!transport || typeof authorize !== 'function') deny('Live audience authority required');
    this.transport=transport;this.authorize=authorize;this.pending=new Map();
  }
  async check(expected,operation,authorization=null) {
    this.transport.guard(operation);
    const live=snapshot(await this.authorize(expected,authorization));
    this.transport.guard(operation);
    if (!same(expected,live) || !live.members.includes(operation.binding.userId)) deny('Audience changed; retain draft and review again');
    const room=operation.client.getRoom(live.roomId);
    const joined=room?.getMembers().filter(member=>['join','invite'].includes(member.membership));
    if (!joined || joined.some(member=>member.membership!=='join') ||
        JSON.stringify(joined.map(member=>member.userId).sort())!==JSON.stringify(live.members))
      deny('Audience membership is not confirmed; sending remains blocked');
  }
  async verifyParent(parent,expected,operation) {
    const messages=await this.transport.messages(expected.roomId);
    this.transport.guard(operation);
    const event=messages.find(message=>message.id===parent.eventId);
    const semantic=event?.content?.['com.ynx.social.moment'];
    if (!event?.encrypted || event.verification?.shieldColour!==0 || event.sender!==expected.owner ||
        semantic?.protocol!==RESTRICTED_MOMENT_PROTOCOL || semantic.kind!=='moment' ||
        semantic.owner!==expected.owner || semantic.revision!==expected.revision || semantic.audience!==expected.kind)
      deny('Verified parent event is unavailable; comment remains blocked');
  }
  async read(index,{signal=null,assertCurrent=()=>{}}={}){
    index=structuredClone(index);
    const expected=snapshot(index.audience),operation=this.transport.capture();
    const local=()=>{this.transport.guard(operation);assertCurrent();if(signal?.aborted)deny('Original read was cancelled; no plaintext returned')};local();
    const authorization={action:'read',transactionId:index.transactionId};
    await this.check(expected,operation,authorization);local();
    const records=await this.transport.messages(expected.roomId);local();
    await this.check(expected,operation,authorization);local();
    const event=records.find(record=>record.id===index.eventId),semantic=event?.content?.['com.ynx.social.moment'];
    const kind=index.parentEventId?'comment':'moment';
    if(!event?.encrypted||event.verification?.shieldColour!==0||event.sender!==index.sender||!expected.members.includes(index.sender)||semantic?.protocol!==RESTRICTED_MOMENT_PROTOCOL||semantic.kind!==kind||semantic.owner!==expected.owner||semantic.revision!==expected.revision||semantic.audience!==expected.kind||semantic.author!==index.sender||kind==='moment'&&index.sender!==expected.owner)deny('Authenticated indexed Moment is unavailable');
    const canonicalSemantic={protocol:RESTRICTED_MOMENT_PROTOCOL,kind,audience:expected.kind,revision:expected.revision,owner:expected.owner,author:index.sender};
    if(event.content.msgtype==='m.file')canonicalSemantic.text=semantic.text;
    if(!sameTypedFields(semantic,canonicalSemantic))deny('Authenticated Moment semantic fields differ from publication');
    if(!sameTypedFields(event.content['m.relates_to'],kind==='comment'?{rel_type:'m.reference',event_id:index.parentEventId}:undefined))deny('Authenticated event relation differs from the index');
    if(!['m.text','m.file'].includes(event.content.msgtype))deny('Unsupported encrypted Moment carrier');
    const text=event.content.msgtype==='m.file'?semantic.text:event.content.body;
    if(typeof text!=='string'||!text.trim()||text.length>16000)deny('Invalid encrypted Moment text');
    if(event.content.msgtype==='m.file'&&!validAttachment(event.content,false))deny('Encrypted attachment descriptor required');
    if(event.content.msgtype==='m.text'&&(event.content.file!==undefined||event.content.info!==undefined||event.content.url!==undefined))deny('Text Moment cannot substitute an attachment');
    return {eventId:index.eventId,text,attachment:event.content.msgtype==='m.file'?structuredClone(event.content):null,
      parent:kind==='moment'?{protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:expected.roomId,revision:expected.revision,owner:expected.owner,eventId:index.eventId}:null};
  }
  async downloadAttachment(index,attachment,{assertCurrent=()=>{},validateIdentity=async()=>{}}={}){
    index=structuredClone(index);attachment=structuredClone(attachment);
    if(!validAttachment(attachment,false))deny('Standard encrypted attachment descriptor required');
    const operation=this.transport.capture(),expected=snapshot(index.audience);
    const bounded=createBoundedOperation();this.transport.downloads?.add(bounded.controller);
    const local=()=>{bounded.guard();this.transport.guard(operation);assertCurrent()};
    const checkpoint=async()=>{
      local();await bounded.wait(()=>validateIdentity({signal:bounded.signal}));local();
      await bounded.wait(()=>this.check(expected,operation,{action:'read',transactionId:index.transactionId}));local();
    };
    let bytes;
    try{
      await checkpoint();
      const current=await bounded.wait(()=>this.read(index,{signal:bounded.signal,assertCurrent:local}));local();
      if(!sameJSON(current.attachment,attachment))deny('Original indexed attachment changed');
      bytes=await bounded.wait(()=>this.transport.downloadAttachment(attachment,{revalidate:checkpoint,assertCurrent:local,signal:bounded.signal}),wipeBytes);
      local();await checkpoint();
      const final=await bounded.wait(()=>this.read(index,{signal:bounded.signal,assertCurrent:local}));local();
      if(!sameJSON(final.attachment,attachment))deny('Original indexed attachment changed');
      await checkpoint();return bytes;
    }catch(error){wipeBytes(bytes);throw error}
    finally{this.transport.downloads?.delete(bounded.controller);bounded.dispose()}
  }
  // Recover original delivery by authenticated remote readback and the existing
  // index authority only. Never call sendMessage or uploadContent here.
  async recover(intent,options={}){
    const bounded=createBoundedOperation({signal:options.signal});this.transport.downloads?.add(bounded.controller);
    const assertCurrent=()=>{bounded.guard();options.assertCurrent?.()};
    try{return await bounded.wait(()=>this.recoverOriginal(intent,{...options,assertCurrent,wait:bounded.wait,signal:bounded.signal}))}
    finally{this.transport.downloads?.delete(bounded.controller);bounded.dispose()}
  }
  async recoverOriginal(intent,{assertCurrent=()=>{},validateIdentity=async()=>{},wait=action=>action(),signal=null}={}){
    intent=structuredClone(intent);
    const expected=snapshot(intent.comment?.index?.audience??intent.audience),operation=this.transport.capture();
    const parent=intent.comment?.parent??null,attachment=intent.preparedAttachment??null;
    const transactionId=intent.transactionId,text=intent.text;
    if(intent.status!=='delivery-unknown'||typeof text!=='string'||!text.trim()||text.length>16000||typeof transactionId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(transactionId))deny('Original unknown intent required');
    if(parent){
      if(intent.comment.author!==operation.binding.userId||parent.protocol!==RESTRICTED_MOMENT_PROTOCOL||parent.eventId!==intent.comment.index.eventId||parent.roomId!==expected.roomId||parent.revision!==expected.revision||parent.owner!==expected.owner)deny('Original comment identity or parent differs');
    }else if(expected.owner!==operation.binding.userId)deny('Original publishing identity differs');
    if(intent.file&&!attachment)deny('Original upload receipt remains unknown; no resend performed');
    if(attachment&&!validAttachment(attachment))deny('Original prepared encrypted attachment required');
    const content={msgtype:'m.text',body:text,'com.ynx.social.moment':{protocol:RESTRICTED_MOMENT_PROTOCOL,kind:parent?'comment':'moment',audience:expected.kind,revision:expected.revision,owner:expected.owner,author:operation.binding.userId}};
    if(attachment){content.msgtype='m.file';content.body=attachment.body;content.file=structuredClone(attachment.file);content.info=structuredClone(attachment.info);content['com.ynx.social.moment'].text=text}
    if(parent)content['m.relates_to']={rel_type:'m.reference',event_id:parent.eventId};
    const authorization={action:'read',transactionId,parentEventId:parent?.eventId};
    const checkpoint=async()=>{this.transport.guard(operation);assertCurrent();await wait(()=>validateIdentity({signal}));this.transport.guard(operation);assertCurrent();await wait(()=>this.check(expected,operation,authorization));this.transport.guard(operation);assertCurrent()};
    await checkpoint();
    const retained=this.pending.get(transactionId);
    if(retained&&(retained.binding!==operation.binding||retained.identity!==JSON.stringify({audience:expected,content})||retained.status!=='unknown'))deny('Original warm intent differs or is still active');
    const records=await wait(()=>this.transport.messages(expected.roomId));this.transport.guard(operation);assertCurrent();await checkpoint();
    const candidates=records.filter(record=>record.transactionId===transactionId||retained?.eventId&&record.id===retained.eventId);
    if(candidates.length!==1)deny('Original remote delivery is not uniquely confirmed; no resend performed');
    const event=structuredClone(candidates[0]);
    if(!/^\$[^\s\x00-\x1f]{1,254}$/.test(event.id)||event.remoteConfirmed!==true||!event.encrypted||event.verification?.shieldColour!==0||event.sender!==operation.binding.userId||event.transactionId!==undefined&&event.transactionId!==transactionId||event.content?.msgtype!==content.msgtype||event.content.body!==content.body||!sameTypedFields(event.content['com.ynx.social.moment'],content['com.ynx.social.moment'])||!sameJSON(event.content.file,content.file)||!sameJSON(event.content.info,content.info)||!sameTypedFields(event.content['m.relates_to'],content['m.relates_to'])||event.content.url!==undefined)deny('Original encrypted event ownership is not confirmed');
    if(parent){await wait(()=>this.verifyParent(parent,expected,operation));this.transport.guard(operation);assertCurrent();await checkpoint()}
    await wait(()=>this.check(expected,operation,{...authorization,action:'index',eventId:event.id}));this.transport.guard(operation);assertCurrent();
    await checkpoint();
    if(retained&&this.pending.get(transactionId)!==retained)deny('Original pending intent changed');
    this.pending.delete(transactionId);
    return Object.freeze({protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:expected.roomId,eventId:event.id,transactionId,owner:expected.owner,kind:expected.kind,revision:expected.revision,parentEventId:parent?.eventId,sender:operation.binding.userId});
  }
  /** @param {{audience: object, text: string, transactionId: string, attachment?: any, parent?: {protocol: string, roomId: string, revision: string, owner: string, eventId: string} | null}} input */
  async publish({audience,text,transactionId,parent=null,attachment=null}) {
    const expected=snapshot(audience),operation=this.transport.capture();
    if (typeof text!=='string' || !text.trim() || text.length>16000 ||
        typeof transactionId!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(transactionId)) deny('Bounded draft and stable transaction identity required');
    if(parent && (parent.protocol!==RESTRICTED_MOMENT_PROTOCOL || parent.roomId!==expected.roomId ||
      parent.revision!==expected.revision || parent.owner!==expected.owner || typeof parent.eventId!=='string' || !parent.eventId.startsWith('$')))
      deny('Comment parent does not match the verified audience');
    if(!parent && expected.owner!==operation.binding.userId) deny('Only the authorized owner may publish this Moment');
    const content={msgtype:'m.text',body:text,'com.ynx.social.moment':{
      protocol:RESTRICTED_MOMENT_PROTOCOL,kind:parent?'comment':'moment',audience:expected.kind,
      revision:expected.revision,owner:expected.owner,author:operation.binding.userId,
    }};
    if(attachment){
      const file=attachment.file;
      if(!validAttachment(attachment))
        deny('Standard encrypted attachment descriptor required; plaintext media is forbidden');
      content.msgtype='m.file';content.body=attachment.body;
      content['file']=structuredClone(file);content['info']=structuredClone(attachment.info);
      content['com.ynx.social.moment']['text']=text;
    }
    if(parent)content['m.relates_to']={rel_type:'m.reference',event_id:parent.eventId};
    const retained=this.pending.get(transactionId);
    const identity=JSON.stringify({audience:expected,content});
    if(retained && (retained.identity!==identity || retained.binding!==operation.binding)) deny('Retry must preserve original draft, audience and identity');
    const intent=retained??{identity,binding:operation.binding,audience:expected,content,status:'draft',eventId:null};
    if(['preparing','sending'].includes(intent.status))deny('This draft is already being sent');
    this.pending.set(transactionId,intent);
    const previousStatus=intent.status;
    intent.status='preparing';
    let started=false;
    const authorization={action:parent?'comment':'publish',transactionId,parentEventId:parent?.eventId};
    try {
      await this.check(expected,operation,authorization);
      if(parent)await this.verifyParent(parent,expected,operation);
      await this.transport.assertTrusted(expected.roomId,operation);
      await this.check(expected,operation,authorization);
      this.transport.guard(operation);
      intent.status='sending';started=true;
      const result=await operation.client.sendMessage(expected.roomId,content,transactionId);
      if (!result || typeof result!=='object' || Array.isArray(result) ||
          typeof result.event_id!=='string' || !/^\$[^\s\x00-\x1f]{1,254}$/.test(result.event_id))
        deny('Publication receipt is invalid; delivery remains unknown');
      intent.eventId=result.event_id;
      const records=await this.transport.messages(expected.roomId);
      this.transport.guard(operation);
      const sent=records.find(record=>record.id===intent.eventId);
      if (!sent?.encrypted || sent.verification?.shieldColour!==0 || sent.sender!==operation.binding.userId ||
          sent.content?.msgtype!==content.msgtype || sent.content.body!==content.body ||
          !sameTypedFields(sent.content['com.ynx.social.moment'],content['com.ynx.social.moment']) ||
          !sameJSON(sent.content.file,content['file']) || !sameJSON(sent.content.info,content['info']) ||
          !sameTypedFields(sent.content['m.relates_to'],content['m.relates_to']))
        deny('Publication event ownership is not confirmed; delivery remains unknown');
      await this.check(expected,operation,{...authorization,action:'index',eventId:intent.eventId});
      this.pending.delete(transactionId);
      return {protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:expected.roomId,eventId:result.event_id,
        owner:expected.owner,kind:expected.kind,revision:expected.revision};
    } catch(error) {
      intent.status=started?'unknown':previousStatus;
      throw error;
    }
  }
}
