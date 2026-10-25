// TEST ONLY. Explicit HTTP/TLS boundary mock; never production Source.
import{EventEmitter}from'node:events';
import{readFileSync}from'node:fs';
let state={body:'',status:200,headers:{'content-type':'application/json','cache-control':'no-store'},calls:0};
export function reset(body,extra={}){state={body,status:200,headers:{'content-type':'application/json','cache-control':'no-store'},calls:0,...extra};}
export function calls(){return state.calls;}
export function request(url,options,callback){
 state.calls++;if(url.origin!=='https://rpc.ynxweb4.com'||options.method!=='GET'||options.agent!==false||options.rejectUnauthorized!==true||typeof options.checkServerIdentity!=='function')throw Error('TEST mock boundary mismatch');
 // Existing filesystem/occupancy controls now pass through the real mandatory
 // Genesis-first production path. Only this TEST peer supplies observational
 // headers; it never changes the production empty admission table.
 const initial=url.pathname==='/node/consensus-genesis',release=initial?JSON.parse(readFileSync(new URL('../test-release.json',import.meta.url))):null;
 const status=initial?200:state.status,headers=initial?{'content-type':'application/json','cache-control':'no-store','x-ynx-comet-genesis-sha256':release.genesis.sha256,'x-ynx-observation-height':JSON.parse(state.body).committedHeight}:state.headers;
 const body=initial?readFileSync(release.genesis.path):Buffer.from(state.body);
 const q=new EventEmitter();q.destroy=()=>{};q.end=()=>queueMicrotask(()=>{const r=new EventEmitter();r.statusCode=status;r.headers=headers;r.complete=true;r.destroy=()=>{};callback(r);if(status===200){r.emit('data',body);r.emit('end');}});return q;
}
