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
    const expectedAvailability={'ynxt-indexed':'source-dependent','ynx-evm-test':'owner-source-dependent','broker-sandbox':'credential-and-provider-dependent','future-live':'disabled'};
    target.innerHTML=channels.map(channel=>{
      const action=actions[channel.id];
      const keys=channelKeys[channel.id];
      const [label,environment,availability,risk]=keys?[
        localized(keys[0],channel.label),localized(keys[1],channel.environment),channel.availability===expectedAvailability[channel.id]?text(keys[2]):channel.availability,localized(keys[3],channel.riskNotice),
      ]:[channel.label,channel.environment,channel.availability,channel.riskNotice];
      const gate=channel.id==='ynx-evm-test'?channel.testMarket:null;
      const safeTestDirectory=gate?.chainId===6423&&gate.sourceCommit==='6663df43e2f973a90a591cc88fc120a540df7f4a'&&gate.dryRunManifestSha256==='efd4d0c8f372a6a5c94a8687c17321b02144c4b812602a5e672252469a585802'&&gate.testOnly===true&&gate.deploymentVerified===false&&gate.chainSubmissionEnabled===false&&gate.publicAddresses===null&&
        Array.isArray(gate.assets)&&gate.assets.length===2&&gate.assets.includes('TEST-AAPL')&&gate.assets.includes('tUSD')&&gate.settlementContract==='TestDvP';
      const draftForm=safeTestDirectory?`<form id="test-market-draft" autocomplete="off"><label>${escapeHTML(text('testDraftQty'))}<input name="quantity" inputmode="decimal" maxlength="24" required></label><label>${escapeHTML(text('testDraftPrice'))}<input name="limitPrice" inputmode="decimal" maxlength="24" required></label><button type="submit">${escapeHTML(text('testDraftPreview'))}</button><p id="test-market-draft-result" role="status" aria-live="polite"></p></form>`:'';
      const testMarketNotice=channel.id==='ynx-evm-test'?`<div class="test-market-gate" data-chain-submission="disabled"><strong>${escapeHTML(text('testAssetDirectory'))}</strong><p>${escapeHTML(text('testMarketPublicUnavailable'))}</p>${draftForm}</div>`:'';
      return `<article class="panel channel-card" data-channel="${escapeHTML(channel.id)}"><div class="panel-head"><div><span class="eyebrow">${escapeHTML(environment)}</span><h3>${escapeHTML(label)}</h3></div><span class="pill ${channel.availability==='disabled'?'warning':'neutral'}">${escapeHTML(availability)}</span></div><p>${escapeHTML(risk)}</p>${testMarketNotice}${action?`<a class="button ${channel.id==='broker-sandbox'?'primary':'ghost'}" href="${action.href}">${escapeHTML(text(action.label))}</a>`:`<button type="button" disabled>${escapeHTML(text('unavailable'))}</button>`}<details><summary>${escapeHTML(text('boundary'))}</summary><p><small>${escapeHTML(channel.availability)}${gate?.reason?` · ${escapeHTML(gate.reason)}`:''}</small></p>${channel.id==='ynx-evm-test'?`<p>${escapeHTML(text('testMarketUnverified'))}</p>${safeTestDirectory?`<small>${escapeHTML(gate.assets.join(' · '))} · ${escapeHTML(gate.settlementContract)}</small>`:''}`:''}<dl><div><dt>${escapeHTML(text('unit'))}</dt><dd>${escapeHTML(channel.unit)}</dd></div><div><dt>${escapeHTML(text('settlement'))}</dt><dd>${escapeHTML(channel.settlement)}</dd></div><div><dt>${escapeHTML(text('custody'))}</dt><dd>${escapeHTML(channel.custody)}</dd></div></dl><small>${(channel.capabilities||[]).length?escapeHTML(channel.capabilities.join(' · ')):escapeHTML(text('noCapabilities'))}</small></details></article>`;
    }).join('');
  };
  document.addEventListener('submit',event=>{
    if(event.target?.id!=='test-market-draft')return;
    event.preventDefault();
    const form=event.target,result=form.querySelector('#test-market-draft-result');
    const quantity=String(form.elements.quantity.value).trim(),price=String(form.elements.limitPrice.value).trim();
    const positive=value=>/^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,6})?$/u.test(value)&&/[1-9]/u.test(value);
    if(!positive(quantity)||!positive(price)){result.textContent=text('testDraftInvalid');return}
    result.textContent=`${quantity} TEST-AAPL @ ${price} tUSD. ${text('testDraftResult')}`;
  });
  fetch('/api/product-catalog',{headers:{Accept:'application/json'}}).then(response=>{
    if(!response.ok)throw new Error('catalog unavailable');
    return response.json();
  }).then(catalog=>{currentCatalog=catalog;render(currentCatalog)}).catch(()=>render(null));
  document.addEventListener('finance:localechange',()=>render(currentCatalog));
})();
