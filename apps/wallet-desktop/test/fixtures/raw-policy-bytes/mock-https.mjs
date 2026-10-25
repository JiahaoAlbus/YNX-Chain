// Explicit transport/TLS boundary MOCK ONLY. The actual normal reader logic,
// source lifecycle, SDK projection, packet and resource run without rewriting.
import{EventEmitter}from'node:events';
export function request(url,options,consume){
 const state=globalThis[Symbol.for('auth.rawpolicy.fixture')];if(!state)throw Error('fixture only');assertOptions(options);state.paths.push(url.pathname);
 const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
  const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json','cache-control':'no-store'};res.destroy=()=>{};consume(res);
  const text=url.pathname==='/status'?JSON.stringify({chainId:6423,catchingUp:false,persistence:true,persistenceError:'',build:{commit:'65efa82e0615',release:'ynx-network-surgical-65efa82e0615'}}):url.pathname==='/blocks/0'?JSON.stringify({height:0,hash:'16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f'}):state.body;
  res.emit('data',Buffer.from(text));res.emit('end');
 });return req;
}
function assertOptions(v){if(v.method!=='GET'||v.rejectUnauthorized!==true||typeof v.checkServerIdentity!=='function'||v.agent!==false)throw Error('original HTTPS contract drift');}
