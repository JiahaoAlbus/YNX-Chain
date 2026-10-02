import {encryptAttachment} from 'matrix-encrypt-attachment';

const limit=25*1024*1024;
const transaction=/^[A-Za-z0-9_-]{16,128}$/;
const media=/^mxc:\/\/[^\s/?#]+\/[^\s/?#]+$/;
const fail=message=>{throw new Error(message)};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value};
const actor=operation=>JSON.stringify([operation.binding.account,operation.binding.userId,operation.binding.deviceId]);

// Uses the original restricted-moment policy consumer and Matrix media codec.
// This is preparation only: neither a message send nor an indexing receipt.
export class RestrictedMomentAttachments {
  constructor({consumer}) {
    if(typeof consumer?.check!=='function'||!consumer.transport)fail('Restricted audience authority is required');
    this.consumer=consumer;
    this.transport=consumer.transport;
    this.pending=new Map();
  }
  async publish({audience,text,bytes,name,mimeType,transactionId,parent=null}) {
    const prepared=await this.prepare(audience,{bytes,name,mimeType,transactionId});
    const entry=this.pending.get(transactionId);
    entry.guard();
    const receipt=await this.consumer.publish({audience:entry.audience,text,transactionId,parent,attachment:prepared.content});
    // Only authenticated message readback plus committed index settles this
    // preparation. Neither upload success nor local encryption is delivery.
    entry.guard();
    this.pending.delete(transactionId);
    return receipt;
  }
  async prepare(audience,{bytes,name='attachment',mimeType='application/octet-stream',transactionId}) {
    if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>limit||!transaction.test(transactionId)||typeof name!=='string'||!name.trim()||name.length>255||typeof mimeType!=='string'||!mimeType||mimeType.length>255)fail('Invalid restricted attachment');
    const operation=this.transport.capture();
    // A mutable actor/device object must not create a new lookup key for an
    // unresolved original transaction. Transaction identity is stable here.
    const key=transactionId;
    let entry=this.pending.get(key);
    if(entry?.busy)fail('Original attachment is already being prepared');
    if(entry?.status==='unknown')fail('Original upload result is unknown; settle it before retrying');
    const retained=entry;
    if(entry) {
      entry.guard();
      if(JSON.stringify(audience)!==JSON.stringify(entry.audience))fail('Original transaction belongs to a different attachment or audience');
    } else {
      const expected=freeze(structuredClone(audience)),audienceIdentity=JSON.stringify(expected),actorIdentity=actor(operation);
      const guard=()=>{
        this.transport.guard(operation);
        if(actor(operation)!==actorIdentity||JSON.stringify(audience)!==audienceIdentity)fail('Original attachment audience or actor identity is different');
      };
      entry={operation,audience:expected,guard,busy:false,status:'draft'};
      this.pending.set(key,entry);
    }
    // Reserve synchronously, before digest/encryption/network awaits.
    entry.busy=true;
    let dispatched=false;
    try {
      const original=bytes.slice(0);
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original)),value=>value.toString(16).padStart(2,'0')).join('');
      entry.guard();
      const identity=JSON.stringify([entry.audience,name,mimeType,digest]);
      if(retained&&entry.identity!==identity)fail('Original transaction belongs to a different attachment or audience');
      entry.identity=identity;
      const authorization={action:'media-prepare',transactionId};
      const check=async()=>{
        entry.guard();
        await this.consumer.check(entry.audience,operation,authorization);
        entry.guard();
        await this.transport.assertTrusted(entry.audience.roomId,operation);
        entry.guard();
      };
      await check();
      if(!entry.encrypted) {
        entry.encrypted=await encryptAttachment(original);
        entry.guard();
      }
      await check();
      if(!entry.uri) {
        entry.guard();
        dispatched=true;entry.status='uploading';
        const uploaded=await operation.client.uploadContent(new Uint8Array(entry.encrypted.data),{type:'application/octet-stream',includeFilename:false});
        if(typeof uploaded?.content_uri!=='string'||!media.test(uploaded.content_uri))fail('Encrypted upload did not return a valid Matrix media receipt');
        // Retain the original receipt even if the account locks during upload.
        entry.uri=uploaded.content_uri;entry.status='uploaded';
        entry.guard();
      }
      await check();
      entry.status='prepared';
      return {transactionId,content:{msgtype:'m.file',body:name,file:{...structuredClone(entry.encrypted.info),url:entry.uri},info:{size:original.byteLength,mimetype:mimeType}}};
    } catch(error) {
      if(dispatched&&!entry.uri)entry.status='unknown';
      throw error;
    } finally {
      entry.busy=false;
    }
  }
}
