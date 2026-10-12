// Only an original trusted launcher may construct this endpoint over its held
// inherited duplex stream. A descriptor number/opaque ID is never admission.
const failure = code => Object.assign(new Error(code), {code});
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).sort().join('|') !== [...keys].sort().join('|')) throw failure('ADMISSION_RECORD_INVALID');
  for (const d of Object.values(Object.getOwnPropertyDescriptors(value))) if (!Object.hasOwn(d,'value') || !d.enumerable) throw failure('ADMISSION_RECORD_INVALID');
}
export function admissionCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '[' + value.map(admissionCanonical).join(',') + ']';
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw failure('ADMISSION_RECORD_INVALID');
  const descriptors=Object.getOwnPropertyDescriptors(value), keys=Reflect.ownKeys(value);
  if(keys.some(k=>typeof k!=='string'||['__proto__','constructor','prototype'].includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable)) throw failure('ADMISSION_RECORD_INVALID');
  return '{'+keys.sort().map(k=>JSON.stringify(k)+':'+admissionCanonical(descriptors[k].value)).join(',')+'}';
}
export function captureInstalledAdmission(value, now) {
  const text=admissionCanonical(value);
  if(Buffer.byteLength(text)>65536) throw failure('ADMISSION_RECORD_CAPACITY');
  const v=JSON.parse(text); exact(v,['selection','sequence','expiresAtMs','account']);
  exact(v.selection,['sourceSelection','receiptSelection','expectedRequest','receiptDirectory']);
  exact(v.selection.sourceSelection,['rootPath','rootDigest','rolePath','roleDigest']);
  exact(v.selection.receiptSelection,['receiptPath','receiptDigest']);
  const r=v.selection.expectedRequest;
  exact(r,['version','purpose','service','productId','platform','applicationId','gatewayOrigin','registryDigest','consumerManifestDigest','gatewayManifestDigest','instanceId','currentReference','operations','requestNonce','requestedAtMs','expiresAtMs']);
  if(r.version!==1||r.purpose!=='wallet-product-session-v2-service-admission/v1'||r.service!=='wallet-product-session-v2'||r.productId!=='developer'||r.platform!=='macos'||r.applicationId!=='com.ynxweb4.developer.testnetpreview'||r.gatewayOrigin!=='https://wallet-auth.ynxweb4.com'||JSON.stringify(r.operations)!==JSON.stringify(['beginYNX','handleReturn','restore','disconnect'])||!hex(r.consumerManifestDigest)||!hex(r.gatewayManifestDigest)||!hex(r.registryDigest)||!hex(r.currentReference)||!hex(v.selection.receiptSelection.receiptDigest)||!hex(v.selection.sourceSelection.rootDigest)||!hex(v.selection.sourceSelection.roleDigest)||typeof r.requestNonce!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(r.requestNonce)||typeof r.instanceId!=='string'||!r.instanceId||typeof v.account!=='string'||!v.account||!Number.isSafeInteger(v.sequence)||v.sequence<1||!Number.isSafeInteger(v.expiresAtMs)||v.expiresAtMs<=now||v.expiresAtMs>r.expiresAtMs||v.expiresAtMs-now>30000||!Number.isSafeInteger(r.requestedAtMs)||r.requestedAtMs>now||!Number.isSafeInteger(r.expiresAtMs)) throw failure('ADMISSION_RECORD_INVALID');
  for(const path of [v.selection.sourceSelection.rootPath,v.selection.sourceSelection.rolePath,v.selection.receiptSelection.receiptPath,v.selection.receiptDirectory]) if(typeof path!=='string'||!path.startsWith('/')||path.includes('\0')||path.split('/').some(p=>p==='.'||p==='..')) throw failure('ADMISSION_RECORD_INVALID');
  if(v.selection.receiptSelection.receiptPath!==v.selection.receiptDirectory+'/'+r.requestNonce+'.admission.json') throw failure('ADMISSION_RECORD_INVALID');
  return v; // Structural capture only; IDE verifies original signatures/custody.
}
export function createOriginalAdmissionBroker({stream, assertChannelCurrent, now=Date.now, schedule=setTimeout, unschedule=clearTimeout}) {
  if(!stream||typeof assertChannelCurrent!=='function') throw failure('WALLET_SERVICE_ADMISSION_NOT_SUPPLIED');
  let retired=false, pending=null, used=false, first=null, bytes=Buffer.alloc(0), floor=-1;
  const current=()=>{const at=now();if(retired||!Number.isSafeInteger(at)||at<floor) throw first??failure('ADMISSION_CHANNEL_RETIRED');floor=at;assertChannelCurrent();return at;};
  const close=(error=failure('ADMISSION_CHANNEL_CLOSED'))=>{
    if(!first) first=error; retired=true;
    if(pending){const p=pending;pending=null;unschedule(p.timer);p.reject(first);}
    stream.off('data',data); stream.off('end',ended); stream.off('close',ended); stream.off('error',errored);
    stream.on('error',()=>{});stream.destroy();
  };
  const ended=()=>close(failure('ADMISSION_CHANNEL_EOF')),errored=e=>close(e);
  const data=chunk=>{
    try{
      current();if(!pending||pending.acked)throw failure('ADMISSION_ACK_DUPLICATE');
      bytes=Buffer.concat([bytes,Buffer.from(chunk)]);if(bytes.length>65536)throw failure('ADMISSION_RECORD_CAPACITY');
      const i=bytes.indexOf(10);if(i<0)return;
      if(i!==bytes.length-1)throw failure('ADMISSION_ACK_CONFLICT');
      const text=bytes.subarray(0,i).toString('utf8'),ack=JSON.parse(text);if(admissionCanonical(ack)!==text)throw failure('ADMISSION_ACK_INVALID');
      exact(ack,['type','requestNonce','receiptDigest','sequence','consumerManifestDigest']);
      if(admissionCanonical(ack)!==admissionCanonical(pending.expected)||current()>=pending.expires)throw failure('ADMISSION_ACK_MISMATCH');
      pending.acked=true;settle();
    }catch(e){close(e);}
  };
  function settle(){if(pending?.acked&&pending.written){const p=pending;pending=null;unschedule(p.timer);p.resolve();}}
  stream.on('data',data);stream.on('end',ended);stream.on('close',ended);stream.on('error',errored);
  return Object.freeze({
    assertCurrent(){current();},close,
    async deliver(publication){
      current();if(used)throw failure('ADMISSION_CHANNEL_ALREADY_USED');used=true;
      const v=captureInstalledAdmission(publication,current()),r=v.selection.expectedRequest;
      const wire=admissionCanonical({type:'installed',selection:v.selection,sequence:v.sequence,expiresAtMs:v.expiresAtMs})+'\n';
      if(Buffer.byteLength(wire)>65536)throw failure('ADMISSION_RECORD_CAPACITY');
      await new Promise((resolve,reject)=>{
        pending={resolve,reject,expires:v.expiresAtMs,acked:false,written:false,expected:{type:'ack',requestNonce:r.requestNonce,receiptDigest:v.selection.receiptSelection.receiptDigest,sequence:v.sequence,consumerManifestDigest:r.consumerManifestDigest}};
        pending.timer=schedule(()=>close(failure('ADMISSION_ACK_TIMEOUT')),Math.max(1,v.expiresAtMs-current()));
        try{stream.write(wire,error=>{if(error){close(error);return;}if(!pending)return;try{if(current()>=pending.expires)throw failure('ADMISSION_ACK_TIMEOUT');pending.written=true;settle();}catch(e){close(e);}});}catch(e){close(e);}
      });
      current();if(now()>=v.expiresAtMs)throw failure('ADMISSION_ACK_TIMEOUT');
    },
  });
}
