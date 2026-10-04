const PREFIX='ynx-shop-checkout-v1:',PHASE_PREFIX='ynx-shop-checkout-dispatch-v1:';
const phaseKey=key=>PHASE_PREFIX+key.slice(PREFIX.length);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
export class UnresolvedCheckoutError extends Error{constructor(){super('An earlier checkout is still unconfirmed. Check its order status, or restore the original cart and address to retry it.');this.code='CHECKOUT_UNRESOLVED'}}

// The durable record contains only opaque intent/CAS identifiers and a digest.
// Addresses, request bodies, product sessions and order records remain in memory.
export function createCheckoutRecovery({storage,withLock=(key,work)=>{
  if(!globalThis.navigator?.locks)throw new Error('This browser cannot safely coordinate checkout recovery. Use a browser with Web Locks support.');
  return navigator.locks.request(key,work);
},digest=hash,newKey=()=>crypto.randomUUID()}={}){
  const durable=()=>storage??globalThis.localStorage;
  const storageKey=async account=>{
    if(typeof account!=='string'||!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(account))throw new Error('An active Shop account is required.');
    return PREFIX+await digest(account);
  };
  function read(key){
    const raw=durable().getItem(key);if(!raw)return null;
    const value=JSON.parse(raw);
    if(Object.keys(value).sort().join(',')!=='cartRevision,digest,key'||typeof value.key!=='string'||value.key.length<8||value.key.length>128||!/^[a-f0-9]{64}$/.test(value.digest)||typeof value.cartRevision!=='string')throw new Error('Saved checkout recovery data is invalid. Keep it for recovery before creating another order.');
    return value;
  }
  function phase(key,record){
    const raw=durable().getItem(phaseKey(key));if(!raw)return 'unknown';
    const value=JSON.parse(raw);
    if(!record||Object.keys(value).sort().join(',')!=='digest,key,phase'||value.key!==record.key||value.digest!==record.digest||!['prepared','dispatching','unknown'].includes(value.phase))throw new Error('Saved checkout dispatch evidence is invalid. Preserve it for recovery.');
    return value.phase;
  }
  function savePhase(key,record,value){const raw=JSON.stringify({key:record.key,digest:record.digest,phase:value});durable().setItem(phaseKey(key),raw);if(durable().getItem(phaseKey(key))!==raw)throw new Error('Checkout dispatch evidence could not be saved. No order was sent.');}
  async function prepare(account,input,cartRevision,assertCurrent=()=>{},unsent=false){
      if(typeof cartRevision!=='string')throw new Error('Refresh the cart before checkout.');
      const key=await storageKey(account),fingerprint=await digest(canonical(input));assertCurrent();
      return withLock(key,()=>{
        assertCurrent();const previous=read(key);phase(key,previous);
        if(previous){if(previous.digest!==fingerprint)throw new UnresolvedCheckoutError();return {...previous,existing:true}}
        const record={key:newKey(),digest:fingerprint,cartRevision};
        durable().setItem(key,JSON.stringify(record));
        if(durable().getItem(key)!==JSON.stringify(record))throw new Error('Checkout recovery could not be saved. No order was sent.');
        if(unsent)savePhase(key,record,'prepared');
        return {...record,existing:false};
      });
  }
  return Object.freeze({
    async pending(account){const key=await storageKey(account),record=read(key);phase(key,record);return record},
    prepare,
    prepareUnsent(account,input,cartRevision,current=()=>{}){return prepare(account,input,cartRevision,current,true)},
    async phase(account,intent){const key=await storageKey(account),record=read(key);if(!record||record.key!==intent.key||record.digest!==intent.digest)throw new UnresolvedCheckoutError();return phase(key,record)},
    async dispatched(account,intent,current=()=>{}){const key=await storageKey(account);return withLock(key,()=>{current();const record=read(key);if(!record||record.key!==intent.key||record.digest!==intent.digest||phase(key,record)!=='prepared')throw new UnresolvedCheckoutError();savePhase(key,record,'dispatching');current()})},
    async unknown(account,intent){const key=await storageKey(account);return withLock(key,()=>{const record=read(key);if(record?.key===intent.key&&phase(key,record)==='dispatching')savePhase(key,record,'unknown')})},
    async exclusive(account,work){
      const key=await storageKey(account);return withLock(key,()=>{const record=read(key);phase(key,record);return work(record)});
    },
    async complete(account,intentKey){
      const key=await storageKey(account);
      return withLock(key,()=>{if(read(key)?.key===intentKey){durable().removeItem(phaseKey(key));if(durable().getItem(phaseKey(key)))throw new Error('Checkout dispatch evidence could not be cleared.');durable().removeItem(key);if(durable().getItem(key))throw new Error('Checkout recovery could not be cleared.')}});
    },
  });
}
