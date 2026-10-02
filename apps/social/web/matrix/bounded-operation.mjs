// Finite local waiting only. This does not issue, renew, cache, or extend a grant.
export function createBoundedOperation({timeoutMs=30000,signal=null}={}){
  const controller=new AbortController();
  const failure=()=>{const error=new Error('Matrix operation cancelled or deadline exceeded; original intent retained');error.code='MATRIX_OPERATION_CANCELLED';return error};
  const abort=()=>controller.abort(failure());
  const timeout=setTimeout(abort,timeoutMs);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const guard=()=>{if(controller.signal.aborted)throw failure()};
  const wait=(action,onLate=()=>{})=>new Promise((resolve,reject)=>{
    let settled=false;
    const discard=value=>{try{onLate(value)}catch{}};
    const finish=(error,value)=>{if(settled)return;settled=true;controller.signal.removeEventListener('abort',cancel);error?reject(error):resolve(value)};
    const cancel=()=>finish(failure());
    controller.signal.addEventListener('abort',cancel,{once:true});
    if(controller.signal.aborted){cancel();return}
    try{Promise.resolve(action()).then(value=>{if(settled){discard(value);return}try{guard();finish(null,value)}catch(error){discard(value);finish(error)}},error=>finish(error))}catch(error){finish(error)}
  });
  return {controller,signal:controller.signal,guard,wait,dispose(){clearTimeout(timeout);signal?.removeEventListener('abort',abort);abort()}};
}
export function wipeBytes(value){if(value instanceof ArrayBuffer)new Uint8Array(value).fill(0);else if(ArrayBuffer.isView(value))new Uint8Array(value.buffer,value.byteOffset,value.byteLength).fill(0)}
