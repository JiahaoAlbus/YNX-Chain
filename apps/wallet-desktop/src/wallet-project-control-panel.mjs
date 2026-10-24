import {appendWalletProjectControlReview} from './wallet-project-control-review-ui.mjs';
// Explicit normal Wallet entry: request/captured context stays in Main/Native.
// Nothing starts on mount, focus, status, history or unlock.
export function mountWalletProjectControlPanel({root,api,getKeyState,document:doc=document}){
 let generation=0,busy=false,reviewUI=null;const request=doc.createElement('section'),result=doc.createElement('p'),buttons=[];
 const live=(before,ticket)=>{const s=getKeyState();return generation===ticket&&!s.locked&&!s.authenticating&&s.account===before.account&&s.revision===before.revision;};
 const render=()=>{const s=getKeyState();for(const b of buttons)b.disabled=busy||s.locked||s.authenticating;reviewUI?.refresh();};
 function button(label,fn){const b=doc.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{
  const before={...getKeyState()},ticket=generation;if(busy||!live(before,ticket))return;busy=true;render();
  try{const r=await fn();if(!live(before,ticket))return;if(r?.ok!==true)throw Error('CONTROL_ORIGINAL_UNAVAILABLE');
   if(label.startsWith('读取')){if(r.value?.walletAccount!==before.account)throw Error('CONTROL_ACCOUNT_CHANGED');request.replaceChildren();reviewUI=appendWalletProjectControlReview({container:request,review:r.value.review,walletAccount:r.value.walletAccount,api,getKeyState,isCurrent:()=>live(before,ticket),onResult:s=>{if(live(before,ticket))result.textContent=s;},document:doc});}
   else if(r.value.reviewClosed===true){generation++;reviewUI=null;request.replaceChildren();result.textContent='本次复核已结束，原记录保留。下一次读取需要独立的新请求，不会重做旧选择。';}
   else result.textContent='原选择状态：'+r.value.phase+'。仅查询原操作，不代表批准、注册或签名完成。';
  }catch{if(live(before,ticket))result.textContent='原请求、当前授权或保存结果未确认。请保留原操作；不会重新签名、自动重试或借用其他用途许可。';}
  finally{busy=false;render();}
 });buttons.push(b);root.append(b);}
 button('读取项目控制请求 / Read project control request',()=>api.startIDEProjectControl());
 button('只查询原选择 / Observe original choice only',()=>api.observeIDEProjectControl());
 button('结束本次复核 / Close this review',()=>api.closeIDEProjectControl());root.append(request,result);render();
 return Object.freeze({render,invalidate(){generation++;reviewUI=null;request.replaceChildren();result.textContent='此视图已失效；原选择和结果仍保留，不会自动重做。';render();}});
}
