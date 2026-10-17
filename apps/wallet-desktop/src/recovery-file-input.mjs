/** A recovery file is local input, never custody authority. Native choosers
 * return to their original DOM node: replacing it retires even same-account
 * stale returns without changing any backup file on disk. */
export function createRecoveryFileInput({document,getContext}){
  let input=document.querySelector("#recovery-file"),intent=null,selection=null;
  const current=before=>{
    const after=getContext();
    return before&&before.open&&after.open&&before.locked&&after.locked&&!after.authenticating&&!after.busy&&
      before.generation===after.generation&&before.revision===after.revision&&Boolean(before.account)&&
      before.account===after.account&&before.kind===after.kind&&before.mode===after.mode;
  };
  function bind(node){
    node.addEventListener("click",()=>{if(node===input){const context=getContext();intent=current(context)?context:null}});
    node.addEventListener("change",()=>{
      if(node!==input)return;
      const before=intent;intent=null;
      if(!current(before)){node.value="";selection=null;return}
      const file=node.files?.[0];selection=file?{context:before,file}:null;
    });
    node.addEventListener("cancel",()=>{if(node===input)intent=null});
  }
  bind(input);
  function invalidate(){
    intent=null;selection=null;
    const next=input.cloneNode(false);next.value="";input.value="";
    input.replaceWith(next);input=next;bind(next);
  }
  return Object.freeze({invalidate,selected:()=>selection&&current(selection.context)?selection.file:null});
}
