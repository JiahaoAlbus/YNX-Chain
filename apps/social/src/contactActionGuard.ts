import {ContactOperation} from './contactOperation';

// The guard is captured when the user reviews the original action, not when a
// stale native alert is pressed. Cancellation never claims server-side rollback.
export async function runCurrentContactAction(
 current:()=>boolean,
 send:(signal:AbortSignal)=>Promise<unknown>,
 timeoutMs=30000,
):Promise<boolean>{
 if(!current())return false;
 const operation=new ContactOperation();
 try{
  await operation.run(signal=>{
   if(!current())throw new Error('Review the contact action again');
   return send(signal);
  },timeoutMs);
  return current();
 }catch(error){
  if(!current())return false;
  throw error;
 }
}
