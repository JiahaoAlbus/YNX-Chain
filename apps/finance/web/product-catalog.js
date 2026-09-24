(()=>{
  const escapeHTML=(value)=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const text=(key)=>window.YNXFinanceLocale?.text(key)??key;
  const localized=(key,source)=>source===window.YNXFinanceLocale?.source(key)?text(key):source;
  let currentCatalog=null;
  const render=(catalog)=>{
    const target=document.querySelector('#product-channels');
    if(!target)return;
    const channels=Array.isArray(catalog?.channels)?catalog.channels:[];
    if(catalog?.schemaVersion!=='finance-product-catalog-v1'||catalog?.aggregationPolicy!=='never-merge-balances-cost-basis-pnl-or-performance-across-channels'||channels.length!==4){
      target.innerHTML=`<article class="panel"><h3>${escapeHTML(text('catalogUnavailable'))}</h3><p>${escapeHTML(text('catalogUnavailableDetail'))}</p></article>`;
      return;
    }
    const actions={
      'ynxt-indexed':{href:'#wallet-connect',label:'portfolio'},
      'ynx-evm-test':{href:'#wallet-connect',label:'ownerEvidence'},
      'broker-sandbox':{href:'#broker-sandbox',label:'searchAssets'},
      'future-live':null,
    };
    const channelKeys={
      'ynxt-indexed':['channelIndexed','environmentIndexed','availabilityIndexed','riskIndexed'],
      'ynx-evm-test':['channelEVM','environmentEVM','availabilityEVM','riskEVM'],
      'broker-sandbox':['channelBroker','environmentBroker','availabilityBroker','riskBroker'],
      'future-live':['channelFuture','environmentFuture','availabilityDisabled','riskFuture'],
    };
    target.innerHTML=channels.map(channel=>{
      const action=actions[channel.id];
      const keys=channelKeys[channel.id];
      const [label,environment,availability,risk]=keys?[
        localized(keys[0],channel.label),localized(keys[1],channel.environment),localized(keys[2],channel.availability),localized(keys[3],channel.riskNotice),
      ]:[channel.label,channel.environment,channel.availability,channel.riskNotice];
      return `<article class="panel channel-card" data-channel="${escapeHTML(channel.id)}"><div class="panel-head"><div><span class="eyebrow">${escapeHTML(environment)}</span><h3>${escapeHTML(label)}</h3></div><span class="pill ${channel.availability==='disabled'?'warning':'neutral'}">${escapeHTML(availability)}</span></div><p>${escapeHTML(risk)}</p>${action?`<a class="button ${channel.id==='broker-sandbox'?'primary':'ghost'}" href="${action.href}">${escapeHTML(text(action.label))}</a>`:`<button type="button" disabled>${escapeHTML(text('unavailable'))}</button>`}<details><summary>${escapeHTML(text('boundary'))}</summary><dl><div><dt>${escapeHTML(text('unit'))}</dt><dd>${escapeHTML(channel.unit)}</dd></div><div><dt>${escapeHTML(text('settlement'))}</dt><dd>${escapeHTML(channel.settlement)}</dd></div><div><dt>${escapeHTML(text('custody'))}</dt><dd>${escapeHTML(channel.custody)}</dd></div></dl><small>${(channel.capabilities||[]).length?escapeHTML(channel.capabilities.join(' · ')):escapeHTML(text('noCapabilities'))}</small></details></article>`;
    }).join('');
  };
  fetch('/api/product-catalog',{headers:{Accept:'application/json'}}).then(response=>{
    if(!response.ok)throw new Error('catalog unavailable');
    return response.json();
  }).then(catalog=>{currentCatalog=catalog;render(currentCatalog)}).catch(()=>render(null));
  document.addEventListener('finance:localechange',()=>render(currentCatalog));
})();
