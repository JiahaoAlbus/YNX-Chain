(()=>{
  const baseRender=render;
  const safeActionURL=(value)=>{try{const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.username===''&&parsed.password===''?parsed.href:''}catch{return ''}};
  const micro=(value,asset='')=>Number.isFinite(Number(value))?`${(Number(value)/1_000_000).toLocaleString(undefined,{maximumFractionDigits:6})}${asset?` ${esc(asset)}`:''}`:'—';
  const bps=(value)=>Number.isFinite(Number(value))?`${(Number(value)/100).toLocaleString(undefined,{maximumFractionDigits:2})}%`:'—';
  const raw=(value)=>typeof value==='string'&&/^-?\d{1,78}$/.test(value)?value:'—';
  const observedAt=(value)=>{const parsed=new Date(value);return value&&!Number.isNaN(parsed.getTime())?parsed.toLocaleString():'unknown'};
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
  const quantDetails=(source)=>{
    if(source?.id!=='quant'||!source?.status?.available||!source?.envelope?.payload)return '';
    const payload=source.envelope.payload;
    const strategies=Array.isArray(payload.strategies)?payload.strategies:[];
    const experiments=Array.isArray(payload.experiments)?payload.experiments:[];
    const mandates=Array.isArray(payload.mandates)?payload.mandates:[];
    const executions=Array.isArray(payload.executions)?payload.executions:[];
    const paper=Array.isArray(payload.paper)?payload.paper:[];
    const active=mandates.filter(item=>!item?.revoked&&Date.parse(item?.expiresAt||'')>Date.now());
    const filled=executions.filter(item=>item?.venueStatus==='filled');
    const latestExperiment=experiments[0];
    const totalNetPnL=experiments.reduce((sum,item)=>sum+(Number(item?.attribution?.userNetPnl)||0),0);
    const totalRealized=experiments.reduce((sum,item)=>sum+(Number(item?.attribution?.userRealizedPnl)||0),0);
    const killSwitch=paper.some(item=>item?.killSwitch===true);
    const strategyRows=strategies.slice(0,5).map(item=>`<li><span>${esc(item.name||item.id||'Strategy')} · ${esc(item.stage||'stage unavailable')}</span><strong>${esc(item.family||'family unavailable')} · ${esc(String(item.strategyHash||'').slice(0,12)||'hash unavailable')}</strong></li>`).join('');
    const executionRows=executions.slice(0,5).map(item=>`<li><span>${esc(item.market||'Market')} · ${esc(item.side||'—')} · ${esc(item.venueStatus||'venue unknown')}</span><strong>${micro(item.amount)} @ ${micro(item.price,'YUSD_TEST')} · ${esc(item.venueOrderId||'order unavailable')}</strong></li>`).join('');
    const riskRows=mandates.slice(0,5).map(item=>`<li><span>${esc(item.market||'Market')} · ${item.revoked?'revoked':'authorized'} · expires ${esc(observedAt(item.expiresAt))}</span><strong>notional ${micro(item.maxNotional)} · loss ${micro(item.maxDailyLoss)} · slippage ${bps(item.maxSlippageBps)} · leverage ${bps(item.maxLeverageBps)}</strong></li>`).join('');
    return `<div class="source-details" aria-label="Live Quant account evidence"><div class="source-metrics"><div><small>Authorized strategies</small><strong>${strategies.length} strategies · ${active.length} active mandates</strong><span>${mandates.length-active.length} expired or revoked</span></div><div><small>Research PnL attribution</small><strong>${micro(totalNetPnL,'YUSD_TEST')}</strong><span>${micro(totalRealized,'YUSD_TEST')} realized · no unsupported component inferred</span></div><div><small>Bounded testnet execution</small><strong>${executions.length} submitted · ${filled.length} filled</strong><span>Venue status is distinct from workflow submission</span></div><div><small>Risk state</small><strong>${killSwitch?'KILL SWITCH ACTIVE':'Kill switch clear'}</strong><span>${latestExperiment?`${bps(latestExperiment.metrics?.maxDrawdownBps)} research max drawdown`:'No account-bound experiment'}</span></div></div><div class="source-evidence-grid"><div><h4>Strategy lifecycle</h4><ul>${strategyRows||'<li class="quiet">No account-authorized strategies.</li>'}</ul></div><div><h4>Authoritative executions</h4><ul>${executionRows||'<li class="quiet">No bounded testnet executions.</li>'}</ul></div><div><h4>Wallet-authorized risk limits</h4><ul>${riskRows||'<li class="quiet">No active or historical mandates.</li>'}</ul></div></div><small class="source-provenance">${esc(source.envelope.coverage||'Authorized Quant account evidence')} · as of ${esc(source.envelope.asOf||'unknown')} · ${experiments.length} research experiments · ${esc(payload.productVersion||source.status.version||'version unavailable')}</small></div>`;
  };
  const dexDetails=(source)=>{
    if(source?.id!=='dex'||!source?.status?.available||!source?.envelope?.payload)return '';
    const payload=source.envelope.payload;
    const positions=Array.isArray(payload.positions)?payload.positions:[];
    const swaps=Array.isArray(payload.swaps)?payload.swaps:[];
    const liquidity=Array.isArray(payload.liquidity)?payload.liquidity:[];
    const pools=Array.isArray(payload.pools)?payload.pools:[];
    const positionRows=positions.slice(0,5).map(item=>`<li><span>${esc(item.pool||'Pool')} · indexed LP position</span><strong>${raw(item.netLpAmount)} LP · added ${raw(item.addedToken0)} / ${raw(item.addedToken1)}</strong></li>`).join('');
    const swapRows=swaps.slice(0,5).map(item=>`<li><span>${esc(item.pool||'Pool')} · block ${esc(item.blockNumber||'—')}</span><strong>${raw(item.amount0)} ${esc(item.token0||'token 0')} / ${raw(item.amount1)} ${esc(item.token1||'token 1')} · fee ${raw(item.fee0)} / ${raw(item.fee1)}</strong></li>`).join('');
    const poolRows=pools.slice(0,5).map(item=>`<li><span>${esc(item.address||'Pool')} · ${esc(item.token0||'token 0')} / ${esc(item.token1||'token 1')}</span><strong>reserves ${raw(item.reserve0)} / ${raw(item.reserve1)} · ${esc(item.feeBps||0)} bps</strong></li>`).join('');
    return `<div class="source-details" aria-label="Live DEX account evidence"><div class="source-metrics"><div><small>Indexed LP positions</small><strong>${positions.length}</strong><span>Raw chain-native share amounts</span></div><div><small>Account swaps</small><strong>${swaps.length}</strong><span>Only committed indexed account actions</span></div><div><small>Liquidity actions</small><strong>${liquidity.length}</strong><span>Add/remove history; no APY inferred</span></div></div><div class="source-evidence-grid"><div><h4>LP positions</h4><ul>${positionRows||'<li class="quiet">No indexed LP position for this account.</li>'}</ul></div><div><h4>Recent swaps</h4><ul>${swapRows||'<li class="quiet">No indexed swaps for this account.</li>'}</ul></div><div><h4>Referenced pools</h4><ul>${poolRows||'<li class="quiet">No account-referenced pool state.</li>'}</ul></div></div><small class="source-provenance">${esc(source.envelope.coverage||'Authorized indexed DEX evidence')} · as of ${esc(source.envelope.asOf||'unknown')} · raw units retain each asset's own decimals · ${esc(payload.productVersion||source.status.version||'version unavailable')}</small></div>`;
  };
  const renderReadSources=(sources)=>{
    const target=document.querySelector('#read-sources');
    if(!target)return;
    const values=Object.values(sources||{});
    target.innerHTML=values.length?values.map(source=>{
      const status=source.status||{},action=source.action||{},href=action.configured?safeActionURL(action.url):'';
      return `<div class="source-card"><div class="row"><div class="row-main"><strong>${esc(source.name||source.id||'External source')}</strong><small>${esc(source.owner||'owner unavailable')} · ${esc(status.syncStatus||'owner-contract-pending')}</small><small>${esc(status.error||source.capability||'No unsupported data inferred')}</small></div><div class="row-value"><span class="evidence">${source.ownerContractAccepted&&status.available?'LIVE':'UNAVAILABLE'}</span>${href?`<small><a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(action.label||'Open owner product')}</a></small>`:'<small>Owner action link not configured</small>'}</div></div>${exchangeDetails(source)}${dexDetails(source)}${quantDetails(source)}</div>`;
    }).join(''):'<div class="empty compact">No cross-product source registry was returned. No balances or performance figures are inferred.</div>';
  };
  render=(data)=>{baseRender(data);renderReadSources(data?.portfolio?.readSources||{})};
})();
