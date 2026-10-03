/** A native file chooser returns to its original DOM input. Replace that input
 * on invalidation so an old selection cannot borrow a newly captured intent.
 * Decoding, account/draft checks and authority stay with the existing caller. */
export function createQRFileInput({document,selector,onClick=()=>{},onChange}){
  let input=document.querySelector(selector);
  function bind(node){
    node.addEventListener("click",()=>{if(node===input)onClick()});
    node.addEventListener("change",()=>{
      const file=node.files?.[0];node.value="";
      if(node!==input)return;
      return onChange(file);
    });
  }
  bind(input);
  function invalidate(){
    const next=input.cloneNode(false);next.value="";input.value="";
    input.replaceWith(next);input=next;bind(next);
  }
  return Object.freeze({invalidate,focus:()=>input.focus()});
}
