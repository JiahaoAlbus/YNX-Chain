import {openSync,closeSync,fstatSync,writeSync,constants} from 'node:fs';

const own = (value,key) => value && (typeof value === 'object' || typeof value === 'function')
  ? Object.getOwnPropertyDescriptor(value,key)?.value : undefined;
const names = new Set(['Error','TypeError','SyntaxError','AbortError','TimeoutError']);
const codes = new Set(['RPC_TIMEOUT','RPC_UNAVAILABLE','RPC_INVALID_RESPONSE','RPC_DURABILITY_UNSUPPORTED','RPC_CAPABILITIES_UNKNOWN']);
const transportCodes = new Set(['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
function causeName(cause) {
  const name=own(cause,'name');
  if(names.has(name))return name;
  // DOMException exposes name through a native prototype getter, not own DATA.
  // Apply only the captured built-in getter; never invoke an error's accessor.
  if(typeof DOMException !== 'undefined') {
    try { const n=Object.getOwnPropertyDescriptor(DOMException.prototype,'name').get.call(cause); if(names.has(n))return n; } catch {}
  }
  return cause instanceof SyntaxError ? 'SyntaxError' : cause instanceof TypeError ? 'TypeError' : cause instanceof Error ? 'Error' : null;
}

// Main-only, fixed-field diagnostic. Never serialize an Error or its message,
// stack, request, params or arbitrary cause. Failure cannot affect safeIPC.
export function recordRPCMetadataFailure(error,filePath) {
  let fd;
  try {
    let observed=error, trace;
    const seen=new Set();
    for(let i=0;i<4 && observed && !seen.has(observed);i++) {
      seen.add(observed); trace=own(observed,'rpcMetadataObservation');
      if(trace)break;
      observed=own(observed,'cause');
    }
    if(!trace)return false;
    const method=own(trace,'method'),stage=own(trace,'stage'),httpStatus=own(trace,'httpStatus'),elapsedMs=own(trace,'elapsedMs');
    if(!['ynx_getFeeModel','ynx_getDurabilityModel'].includes(method) || !['fetch','response','decode','envelope'].includes(stage) || !(httpStatus===null || Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599) || !Number.isSafeInteger(elapsedMs)||elapsedMs<0||elapsedMs>86400000)return false;
    const errorCode=own(own(observed,'data'),'code'),cause=own(observed,'cause');
    // A nested transport code is useful for Node fetch TypeError causes, but
    // never copy free text from platform or remote errors.
    const causeCode=own(cause,'code') ?? own(own(cause,'cause'),'code');
    const line=Buffer.from(JSON.stringify({version:1,at:new Date().toISOString(),method,stage,httpStatus,elapsedMs,errorCode:codes.has(errorCode)?errorCode:null,causeName:causeName(cause),causeCode:transportCodes.has(causeCode)?causeCode:null})+'\n');
    if(line.length>1024 || constants.O_NOFOLLOW===undefined || constants.O_NONBLOCK===undefined)return false;
    // Refuse special files without blocking before fstat can inspect the fd.
    fd=openSync(filePath,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.nlink!==1 || (stat.mode&0o777)!==0o600 || typeof process.getuid==='function'&&stat.uid!==process.getuid() || stat.size+line.length>65536)return false;
    return writeSync(fd,line)===line.length;
  } catch { return false; }
  finally { if(fd!==undefined)try{closeSync(fd);}catch{} }
}
