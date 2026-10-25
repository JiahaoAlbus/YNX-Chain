// TEST ONLY. Explicit HTTP/TLS boundary mock; never production Source.
import{EventEmitter}from'node:events';
let state={body:'',status:200,headers:{'content-type':'application/json','cache-control':'no-store'},calls:0,paths:[]};
export function reset(body,extra={}){state={body,status:200,headers:{'content-type':'application/json','cache-control':'no-store'},calls:0,paths:[],...extra};}
export function routes(values){reset('');state.routes=values;}
export function calls(){return state.calls;}
export function paths(){return state.paths.slice();}
export function request(url,options,callback){
 state.calls++;state.paths.push(url.pathname);if(url.origin!=='https://rpc.ynxweb4.com'||url.search||options.method!=='GET'||options.agent!==false||options.rejectUnauthorized!==true||typeof options.checkServerIdentity!=='function'||options.body!==undefined)throw Error('TEST mock boundary mismatch');
 const reply=state.routes?.[url.pathname]??state;
 const q=new EventEmitter();q.destroy=()=>{};q.end=()=>queueMicrotask(()=>{const r=new EventEmitter();r.statusCode=reply.status??200;r.headers=reply.headers??{'content-type':'application/json','cache-control':'no-store'};r.complete=true;r.destroy=()=>{};callback(r);if(r.statusCode===200){r.emit('data',Buffer.from(reply.body));reply.beforeEnd?.();r.emit('end');}});return q;
}
