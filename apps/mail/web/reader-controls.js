addEventListener('DOMContentLoaded',()=>{
  const reader=document.querySelector('#reading-pane');
  const observer=new MutationObserver(()=>{
    const verified=reader.querySelector('.verified');if(verified&&verified.textContent!=='✓ Mail 服务签名身份')verified.textContent='✓ Mail 服务签名身份';
    for(const button of reader.querySelectorAll('[data-attachment]:not([data-ready])')){
      button.dataset.ready='1';
      button.onclick=()=>{
        const attachment=state.selected?.attachments?.find(item=>(item.id||item.sha256)===button.dataset.attachment);
        if(!attachment)return;
        const bytes=Uint8Array.from(atob(attachment.content_base64),char=>char.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:attachment.media_type||'application/octet-stream'}));
        const link=document.createElement('a');link.href=url;link.download=attachment.name;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
    }
    const actions=reader.querySelector('.reader-actions');
    if(!actions||!state.selected||reader.querySelector('#block-sender'))return;
    const block=document.createElement('button');block.id='block-sender';block.className='quiet';block.textContent='屏蔽发件人';
    block.onclick=async()=>{if(!confirm(`屏蔽 ${state.selected.sender_handle}？之后可从审计记录确认，并通过解除屏蔽接口恢复。`))return;try{await api('/v1/blocks',{method:'POST',body:JSON.stringify({handle:state.selected.sender_handle})});toast('发件人已屏蔽；后续投递将明确失败')}catch(error){toast(error.message)}};
    actions.insertBefore(block,actions.lastElementChild);
    for(const delivery of state.selected.deliveries.filter(item=>item.state==='failed')){
      const retry=document.createElement('button');retry.className='quiet';retry.textContent=`重试 ${delivery.recipient}`;
      retry.onclick=async()=>{try{await api(`/v1/messages/${state.selected.id}/retry`,{method:'POST',body:JSON.stringify({recipient:delivery.recipient})});toast('已重试；投递状态已更新');await loadMessages()}catch(error){toast(error.message)}};
      actions.insertBefore(retry,actions.lastElementChild);
    }
  });
  observer.observe(reader,{childList:true,subtree:true});
});
