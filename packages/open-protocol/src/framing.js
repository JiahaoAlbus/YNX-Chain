// Existing YNX E grammar, narrowed to the OPEN control-message budget.
// E(fields) = U32BE(count) || (U32BE(byteLength(field)) || field)*.
// This is framing only: no OPEN domain, schema, authority or crypto provider.
export const OPEN_CONTROL_MAX_BYTES=1048576;
export const OPEN_CONTROL_MAX_FIELDS=1024;
const invalid=reason=>{throw Object.assign(new Error(reason),{code:'INVALID'});};
const bounds=reason=>{throw Object.assign(new Error(reason),{code:'BOUNDS'});};
const typedArray=Object.getPrototypeOf(Uint8Array.prototype);
const byteLength=Object.getOwnPropertyDescriptor(typedArray,'byteLength').get;
const originalBuffer=Object.getOwnPropertyDescriptor(typedArray,'buffer').get;
const originalSet=Uint8Array.prototype.set;
function bytes(value){
  let n,b;try{n=byteLength.call(value);b=originalBuffer.call(value);}catch{invalid('Uint8Array required');}
  if(!(value instanceof Uint8Array)||typeof SharedArrayBuffer!=='undefined'&&b instanceof SharedArrayBuffer)invalid('detached or shared input is not a control frame');
  return n;
}
function capture(value,n){const out=new Uint8Array(n);try{originalSet.call(out,value);}catch{invalid('detached byte input');}return out;}
function count(n){if(!Number.isSafeInteger(n)||n<0||n>OPEN_CONTROL_MAX_FIELDS)bounds('field count');return n;}
export function encodeFields(fields){
  if(!Array.isArray(fields))invalid('fields array required');count(fields.length);
  const ds=Object.getOwnPropertyDescriptors(fields);
  if(Reflect.ownKeys(ds).length!==fields.length+1)invalid('sparse or decorated field list');
  const captured=[];let size=4;
  for(let i=0;i<fields.length;i++){
    const d=ds[i];if(!d||!Object.hasOwn(d,'value'))invalid('data fields only');
    const n=bytes(d.value);if(n>OPEN_CONTROL_MAX_BYTES||size>OPEN_CONTROL_MAX_BYTES-4-n)bounds('control frame size');
    captured.push(capture(d.value,n));size+=4+n;
  }
  const out=new Uint8Array(size),view=new DataView(out.buffer);view.setUint32(0,captured.length,false);
  let at=4;for(const field of captured){view.setUint32(at,field.byteLength,false);at+=4;out.set(field,at);at+=field.byteLength;}
  return out;
}
export function decodeFields(input,expectedCount){
  count(expectedCount);const size=bytes(input);
  if(size>OPEN_CONTROL_MAX_BYTES)bounds('control frame size');
  // Detach from caller mutations before parsing. Validate all offsets before
  // allocating any length selected by the frame.
  const wire=capture(input,size),view=new DataView(wire.buffer);
  if(size<4+expectedCount*4||view.getUint32(0,false)!==expectedCount)invalid('field count or truncated frame');
  const ranges=[];let at=4;
  for(let i=0;i<expectedCount;i++){
    if(at>size-4)invalid('truncated field length');const n=view.getUint32(at,false);at+=4;
    if(n>size-at)invalid('truncated field');ranges.push([at,at+n]);at+=n;
  }
  if(at!==size)invalid('trailing bytes');
  return Object.freeze(ranges.map(([a,b])=>wire.slice(a,b)));
}
