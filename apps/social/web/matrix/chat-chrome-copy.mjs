// Translate interface chrome only. Never rewrite a selected room name, draft,
// message body, contact label or device identifier when the locale changes.
export function mountChatChromeCopy({root,copy,document=root.ownerDocument,hasRoom=()=>false,Observer=document?.defaultView?.MutationObserver??globalThis.MutationObserver}){
 const refresh=()=>{
  for(const node of root.querySelectorAll('[data-chat-copy]')){
   if(!node.dataset.chatCopy)continue;
   const value=copy.text(node.dataset.chatCopy);if(node.textContent!==value)node.textContent=value;
  }
  const title=root.querySelector('[data-room-title]');
  if(title&&!hasRoom()){const value=copy.text('conversations');if(title.textContent!==value)title.textContent=value;}
  const messages=root.querySelector('[data-messages]');
  if(messages){const value=copy.text('encryptedMessages');if(messages.getAttribute('aria-label')!==value)messages.setAttribute('aria-label',value);}
 };
 refresh();
 const observer=typeof Observer==='function'&&document?.documentElement?new Observer(refresh):null;
 observer?.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 return {refresh,dispose:()=>observer?.disconnect()};
}
