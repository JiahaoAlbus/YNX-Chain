import {ContactOperation} from './contactOperation';

// The guard is captured when the user reviews the original action, not when a
// stale native alert is pressed. Cancellation never claims server-side rollback.
export async function runCurrentContactAction(
 current:()=>boolean,
 send:(signal:AbortSignal)=>Promise<unknown>,
 timeoutMs=30000,
 parent?:AbortSignal,
):Promise<boolean>{
 if(!current()||parent?.aborted)return false;
 const operation=new ContactOperation();
 const cancel=()=>operation.cancel();parent?.addEventListener('abort',cancel,{once:true});
 try{
  await operation.run(signal=>{
   if(!current()||parent?.aborted)throw new Error('Review the contact action again');
   return send(signal);
  },timeoutMs);
  return current()&&!parent?.aborted;
 }catch(error){
  if(!current()||parent?.aborted)return false;
  throw error;
 }finally{parent?.removeEventListener('abort',cancel)}
}
