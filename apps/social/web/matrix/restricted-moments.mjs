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

// authorize is supplied by the actual approved backend integration, never by
// a follow list or assertTrusted. No endpoint or consent scope is invented here.
export class RestrictedMoments {
  constructor({transport,authorize}) {
    if (!transport || typeof authorize !== 'function') deny('Live audience authority required');
    this.transport=transport;this.authorize=authorize;this.pending=new Map();
  }
  async check(expected,operation) {
    this.transport.guard(operation);
    const live=snapshot(await this.authorize(expected));
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
  async publish({audience,text,transactionId,parent=null}) {
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
    try {
      await this.check(expected,operation);
      if(parent)await this.verifyParent(parent,expected,operation);
      await this.transport.assertTrusted(expected.roomId,operation);
      await this.check(expected,operation);
      intent.status='sending';started=true;
      const result=await operation.client.sendMessage(expected.roomId,content,transactionId);
      intent.eventId=result?.event_id??null;
      await this.check(expected,operation);
      this.pending.delete(transactionId);
      return {protocol:RESTRICTED_MOMENT_PROTOCOL,roomId:expected.roomId,eventId:result.event_id,
        owner:expected.owner,kind:expected.kind,revision:expected.revision};
    } catch(error) {
      intent.status=started?'unknown':previousStatus;
      throw error;
    }
  }
}
