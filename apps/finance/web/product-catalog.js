(()=>{
  const escapeHTML=(value)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const render=(catalog)=>{
    const target=document.querySelector('#product-channels');
    if(!target)return;
    const channels=Array.isArray(catalog?.channels)?catalog.channels:[];
    if(catalog?.schemaVersion!=='finance-product-catalog-v1'||catalog?.aggregationPolicy!=='never-merge-balances-cost-basis-pnl-or-performance-across-channels'||channels.length!==4){
      target.innerHTML='<article class="panel"><h3>Product catalog unavailable</h3><p>Finance will not merge or infer product balances while the versioned catalog is unavailable.</p></article>';
      return;
    }
    const actions={
      'ynxt-indexed':{href:'#wallet-connect',label:'Connect to view your portfolio'},
      'ynx-evm-test':{href:'#wallet-connect',label:'Connect to view owner evidence'},
      'broker-sandbox':{href:'#broker-sandbox',label:'Search official Sandbox assets'},
      'future-live':null,
    };
    target.innerHTML=channels.map(channel=>{
      const action=actions[channel.id];
      return `<article class="panel channel-card" data-channel="${escapeHTML(channel.id)}"><div class="panel-head"><div><span class="eyebrow">${escapeHTML(channel.environment)}</span><h3>${escapeHTML(channel.label)}</h3></div><span class="pill ${channel.availability==='disabled'?'warning':'neutral'}">${escapeHTML(channel.availability)}</span></div><p>${escapeHTML(channel.riskNotice)}</p>${action?`<a class="button ${channel.id==='broker-sandbox'?'primary':'ghost'}" href="${action.href}">${escapeHTML(action.label)}</a>`:'<button type="button" disabled>Not available</button>'}<details><summary>Evidence and product boundary</summary><dl><div><dt>Unit</dt><dd>${escapeHTML(channel.unit)}</dd></div><div><dt>Settlement</dt><dd>${escapeHTML(channel.settlement)}</dd></div><div><dt>Custody</dt><dd>${escapeHTML(channel.custody)}</dd></div></dl><small>${(channel.capabilities||[]).length?escapeHTML(channel.capabilities.join(' · ')):'No enabled capabilities'}</small></details></article>`;
    }).join('');
  };
  fetch('/api/product-catalog',{headers:{Accept:'application/json'}}).then(response=>{
    if(!response.ok)throw new Error('catalog unavailable');
    return response.json();
  }).then(render).catch(()=>render(null));
})();
