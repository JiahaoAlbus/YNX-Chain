(()=>{
  const baseRender=render;
  const safeActionURL=(value)=>{try{const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.username===''&&parsed.password===''?parsed.href:''}catch{return ''}};
  const renderReadSources=(sources)=>{
    const target=document.querySelector('#read-sources');
    if(!target)return;
    const values=Object.values(sources||{});
    target.innerHTML=values.length?values.map(source=>{
      const status=source.status||{},action=source.action||{},href=action.configured?safeActionURL(action.url):'';
      return `<div class="row"><div class="row-main"><strong>${esc(source.name||source.id||'External source')}</strong><small>${esc(source.owner||'owner unavailable')} · ${esc(status.syncStatus||'owner-contract-pending')}</small><small>${esc(status.error||source.capability||'No unsupported data inferred')}</small></div><div class="row-value"><span class="evidence">${source.ownerContractAccepted&&status.available?'LIVE':'UNAVAILABLE'}</span>${href?`<small><a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(action.label||'Open owner product')}</a></small>`:'<small>Owner action link not configured</small>'}</div></div>`;
    }).join(''):'<div class="empty compact">No cross-product source registry was returned. No balances or performance figures are inferred.</div>';
  };
  render=(data)=>{baseRender(data);renderReadSources(data?.portfolio?.readSources||{})};
})();
