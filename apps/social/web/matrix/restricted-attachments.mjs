import {encryptAttachment} from 'matrix-encrypt-attachment';

const limit=25*1024*1024;
const transaction=/^[A-Za-z0-9_-]{16,128}$/;
const media=/^mxc:\/\/[^\s/?#]+\/[^\s/?#]+$/;
const fail=message=>{throw new Error(message)};

// Uses the original restricted-moment policy consumer and Matrix media codec.
// This is preparation only: neither a message send nor an indexing receipt.
export class RestrictedMomentAttachments {
  constructor({consumer}) {
    if(typeof consumer?.check!=='function'||!consumer.transport)fail('Restricted audience authority is required');
    this.consumer=consumer;
    this.transport=consumer.transport;
    this.pending=new Map();
  }
  async prepare(audience,{bytes,name='attachment',mimeType='application/octet-stream',transactionId}) {
    if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>limit||!transaction.test(transactionId)||typeof name!=='string'||!name.trim()||name.length>255||typeof mimeType!=='string'||!mimeType||mimeType.length>255)fail('Invalid restricted attachment');
    const operation=this.transport.capture();
    const key=JSON.stringify([operation.binding.account,operation.binding.userId,operation.binding.deviceId,transactionId]);
    let entry=this.pending.get(key);
    if(entry?.busy)fail('Original attachment is already being prepared');
    if(entry?.status==='unknown')fail('Original upload result is unknown; settle it before retrying');
    const retained=entry;
    if(entry) {
      this.transport.guard(entry.operation);
    } else {
      entry={operation,busy:false,status:'draft'};
      this.pending.set(key,entry);
    }
    // Reserve synchronously, before digest/encryption/network awaits.
    entry.busy=true;
    let dispatched=false;
    try {
      const original=bytes.slice(0);
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original)),value=>value.toString(16).padStart(2,'0')).join('');
      this.transport.guard(operation);
      const identity=JSON.stringify([audience,name,mimeType,digest]);
      if(retained&&entry.identity!==identity)fail('Original transaction belongs to a different attachment or audience');
      entry.identity=identity;
      const authorization={action:'media-prepare',transactionId};
      const check=async()=>{
        this.transport.guard(operation);
        await this.consumer.check(audience,operation,authorization);
        this.transport.guard(operation);
        await this.transport.assertTrusted(audience.roomId,operation);
        this.transport.guard(operation);
      };
      await check();
      if(!entry.encrypted) {
        entry.encrypted=await encryptAttachment(original);
        this.transport.guard(operation);
      }
      await check();
      if(!entry.uri) {
        this.transport.guard(operation);
        dispatched=true;entry.status='uploading';
        const uploaded=await operation.client.uploadContent(new Uint8Array(entry.encrypted.data),{type:'application/octet-stream',includeFilename:false});
        if(typeof uploaded?.content_uri!=='string'||!media.test(uploaded.content_uri))fail('Encrypted upload did not return a valid Matrix media receipt');
        // Retain the original receipt even if the account locks during upload.
        entry.uri=uploaded.content_uri;entry.status='uploaded';
        this.transport.guard(operation);
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
