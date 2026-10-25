// TEST ONLY. Explicit HTTP/TLS boundary mock; never production Source.
import{EventEmitter}from'node:events';
let state={body:'',status:200,headers:{'content-type':'application/json','cache-control':'no-store'},calls:0};
export function reset(body,extra={}){state={body,status:200,headers:{'content-type':'application/json','cache-control':'no-store'},calls:0,...extra};}
export function calls(){return state.calls;}
export function request(url,options,callback){
 state.calls++;if(url.origin!=='https://rpc.ynxweb4.com'||options.method!=='GET'||options.agent!==false||options.rejectUnauthorized!==true||typeof options.checkServerIdentity!=='function')throw Error('TEST mock boundary mismatch');
 const q=new EventEmitter();q.destroy=()=>{};q.end=()=>queueMicrotask(()=>{const r=new EventEmitter();r.statusCode=state.status;r.headers=state.headers;r.destroy=()=>{};callback(r);if(state.status===200){r.emit('data',Buffer.from(state.body));r.emit('end');}});return q;
}
