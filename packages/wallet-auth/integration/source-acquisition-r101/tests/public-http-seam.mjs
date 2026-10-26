import {EventEmitter} from 'node:events';
// No socket opened. Exercises production event ordering/caps/terminal handling.
export function request(url,options,accept){
 const mode=globalThis.__auth101http.mode,req=new EventEmitter();
 req.destroy=()=>{queueMicrotask(()=>req.emit('close'));};
 req.end=()=>queueMicrotask(()=>{
  if(mode==='timeout'){req.emit('timeout');return;}
  const res=new EventEmitter();res.statusCode=mode==='bad-status'?503:200;res.headers={'content-type':mode==='bad-mime'?'application/jsonx':'application/json'};res.complete=false;
  res.destroy=()=>{res.emit('error',Error('PUBLIC destroy error after first cause'));res.emit('close');req.emit('close');};
  accept(res);if(mode==='bad-status'||mode==='bad-mime')return;
  if(mode==='truncated'){res.emit('aborted');res.emit('close');req.emit('close');return;}
  res.emit('data',Buffer.from(JSON.stringify({public:mode==='oversize'?'x'.repeat(393216):'x'.repeat(20000)})));
  res.complete=true;res.emit('end');res.emit('close');req.emit('close');
 });return req;
}
