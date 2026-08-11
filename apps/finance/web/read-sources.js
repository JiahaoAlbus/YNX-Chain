(()=>{
  const baseRender=render;
  const safeActionURL=(value)=>{try{const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.username===''&&parsed.password===''?parsed.href:''}catch{return ''}};
  const micro=(value,asset='')=>Number.isFinite(Number(value))?`${(Number(value)/1_000_000).toLocaleString(undefined,{maximumFractionDigits:6})}${asset?` ${esc(asset)}`:''}`:'—';
  const exchangeDetails=(source)=>{
    if(source?.id!=='exchange'||!source?.status?.available||!source?.envelope?.payload)return '';
    const payload=source.envelope.payload;
    const balances=Array.isArray(payload.balances)?payload.balances:[];
    const orders=Array.isArray(payload.orders)?payload.orders:[];
    const trades=Array.isArray(payload.trades)?payload.trades:[];
    const positions=Array.isArray(payload.positions)?payload.positions:[];
    const funding=Array.isArray(payload.funding)?payload.funding:[];
    const fees=Array.isArray(payload.fees)?payload.fees:[];
    const feeTotal=fees.reduce((sum,item)=>sum+(Number(item?.amountMicro)||0),0);
    const openOrders=orders.filter(item=>item?.status==='open'||item?.status==='partially_filled');
    const evidenceRows=(items,kind)=>items.slice(-5).reverse().map(item=>{
      if(kind==='position')return `<li><span>${esc(item.market||'Position')} · ${esc(item.status||'unknown')}</span><strong>${micro(item.sizeMicro)} base · PnL ${micro(item.unrealizedPnlMicro,'YUSD_TEST')}</strong></li>`;
      return `<li><span>${esc(item.market||kind)} · ${esc(item.side||'—')} · ${esc(item.status||'filled')}</span><strong>${micro(item.amountMicro)} @ ${micro(item.priceMicro,'YUSD_TEST')}</strong></li>`;
    }).join('');
    return `<div class="source-details" aria-label="Live Exchange account evidence"><div class="source-metrics">${balances.map(item=>`<div><small>${esc(item.asset||'Asset')} available</small><strong>${micro(item.availableMicro,item.asset||'')}</strong><span>${micro(item.reservedMicro,item.asset||'')} reserved</span></div>`).join('')}<div><small>Margin equity</small><strong>${micro(payload.equityMicro,'YUSD_TEST')}</strong><span>${micro(payload.freeCollateralMicro,'YUSD_TEST')} free</span></div><div><small>Persisted activity</small><strong>${openOrders.length} open · ${trades.length} fills</strong><span>${micro(feeTotal,'YUSD_TEST')} recorded fees</span></div></div><div class="source-evidence-grid"><div><h4>Recent spot fills</h4><ul>${evidenceRows(trades,'fill')||'<li class="quiet">No persisted fills for this account.</li>'}</ul></div><div><h4>Open spot orders</h4><ul>${evidenceRows(openOrders,'order')||'<li class="quiet">No open spot orders.</li>'}</ul></div><div><h4>Perpetual positions</h4><ul>${evidenceRows(positions,'position')||'<li class="quiet">No open perpetual positions.</li>'}</ul></div></div><small class="source-provenance">${esc(source.envelope.coverage||'Authorized Exchange account evidence')} · as of ${esc(source.envelope.asOf||'unknown')} · ${funding.length} funding records · ${esc(payload.productVersion||source.status.version||'version unavailable')}</small></div>`;
  };
  const renderReadSources=(sources)=>{
    const target=document.querySelector('#read-sources');
    if(!target)return;
    const values=Object.values(sources||{});
    target.innerHTML=values.length?values.map(source=>{
      const status=source.status||{},action=source.action||{},href=action.configured?safeActionURL(action.url):'';
      return `<div class="source-card"><div class="row"><div class="row-main"><strong>${esc(source.name||source.id||'External source')}</strong><small>${esc(source.owner||'owner unavailable')} · ${esc(status.syncStatus||'owner-contract-pending')}</small><small>${esc(status.error||source.capability||'No unsupported data inferred')}</small></div><div class="row-value"><span class="evidence">${source.ownerContractAccepted&&status.available?'LIVE':'UNAVAILABLE'}</span>${href?`<small><a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(action.label||'Open owner product')}</a></small>`:'<small>Owner action link not configured</small>'}</div></div>${exchangeDetails(source)}</div>`;
    }).join(''):'<div class="empty compact">No cross-product source registry was returned. No balances or performance figures are inferred.</div>';
  };
  render=(data)=>{baseRender(data);renderReadSources(data?.portfolio?.readSources||{})};
})();
