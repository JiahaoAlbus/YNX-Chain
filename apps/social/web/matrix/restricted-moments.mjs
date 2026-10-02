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
  async read(index){
    const expected=snapshot(index.audience),operation=this.transport.capture();
    const authorization={action:'read',transactionId:index.transactionId};
    await this.check(expected,operation,authorization);
    const records=await this.transport.messages(expected.roomId);this.transport.guard(operation);
    await this.check(expected,operation,authorization);
    const event=records.find(record=>record.id===index.eventId),semantic=event?.content?.['com.ynx.social.moment'];
    const kind=index.parentEventId?'comment':'moment';
    if(!event?.encrypted||event.verification?.shieldColour!==0||event.sender!==index.sender||!expected.members.includes(index.sender)||semantic?.protocol!==RESTRICTED_MOMENT_PROTOCOL||semantic.kind!==kind||semantic.owner!==expected.owner||semantic.revision!==expected.revision||semantic.audience!==expected.kind||semantic.author!==index.sender||kind==='moment'&&index.sender!==expected.owner)deny('Authenticated indexed Moment is unavailable');
    if(kind==='comment'&&!sameTypedFields(event.content['m.relates_to'],{rel_type:'m.reference',event_id:index.parentEventId}))deny('Authenticated comment parent differs from the index');
    if(!['m.text','m.file'].includes(event.content.msgtype))deny('Unsupported encrypted Moment carrier');
    const text=event.content.msgtype==='m.file'?semantic.text:event.content.body;
    if(typeof text!=='string'||!text.trim()||text.length>16000)deny('Invalid encrypted Moment text');
    if(event.content.msgtype==='m.file'&&(!event.content.file||event.content.url||event.content.file.v!=='v2'||!event.content.file.url?.startsWith('mxc://')))deny('Encrypted attachment descriptor required');
    return {eventId:index.eventId,text,attachment:event.content.msgtype==='m.file'?structuredClone(event.content):null,
      parent:kind==='moment'?{protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:expected.roomId,revision:expected.revision,owner:expected.owner,eventId:index.eventId}:null};
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
      if(attachment.msgtype!=='m.file'||attachment.url!==undefined||typeof attachment.body!=='string'||!attachment.body||attachment.body.length>255||
        !file||file.v!=='v2'||typeof file.url!=='string'||!/^mxc:\/\/[^\s/?#]+\/[^\s/?#]+$/.test(file.url)||
        typeof file.iv!=='string'||!file.iv||typeof file.hashes?.sha256!=='string'||!file.hashes.sha256||
        file.key?.kty!=='oct'||file.key.alg!=='A256CTR'||typeof file.key.k!=='string'||!file.key.k||
        !Number.isSafeInteger(attachment.info?.size)||attachment.info.size<1||attachment.info.size>25*1024*1024||typeof attachment.info.mimetype!=='string')
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
