(()=>{
  const baseRender=render;
  const locale=()=>typeof window!=='undefined'&&window.YNXFinanceLocale?.get?.()==='zh-CN'?'zh-CN':'en';
  const label=(english,chinese)=>locale()==='zh-CN'?chinese:english;
  const safeActionURL=(value)=>{try{const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.username===''&&parsed.password===''?parsed.href:''}catch{return ''}};
  const exactInteger=value=>typeof value==='bigint'?value:typeof value==='number'&&Number.isSafeInteger(value)?BigInt(value):typeof value==='string'&&/^-?\d{1,78}$/.test(value)?BigInt(value):null;
  const scaled=(value,scale,digits)=>{const units=exactInteger(value);if(units===null)return null;const negative=units<0n,absolute=negative?-units:units,whole=absolute/scale,fraction=(absolute%scale).toString().padStart(digits,'0').replace(/0+$/,'');return `${negative?'-':''}${whole.toLocaleString(locale())}${fraction?'.'+fraction:''}`};
  const micro=(value,asset='')=>{const amount=scaled(value,1_000_000n,6);return amount===null?'—':`${amount}${asset?` ${esc(asset)}`:''}`};
  const bps=value=>{const amount=scaled(value,100n,2);return amount===null?'—':`${amount}%`};
  const leverage=value=>{const amount=scaled(value,10_000n,4);return amount===null?'—':`${amount}×`};
  const sumExact=values=>{let total=0n;for(const value of values){const amount=exactInteger(value);if(amount===null)return null;total+=amount}return total};
  const raw=(value)=>typeof value==='string'&&/^-?\d{1,78}$/.test(value)?value:'—';
  const observedAt=(value)=>{const parsed=new Date(value);return value&&!Number.isNaN(parsed.getTime())?parsed.toLocaleString(locale()):label('unknown','未知')};
  const exchangeDetails=(source)=>{
    if(source?.id!=='exchange'||!source?.status?.available||!source?.envelope?.payload)return '';
    const payload=source.envelope.payload;
    const balances=Array.isArray(payload.balances)?payload.balances:[];
    const orders=Array.isArray(payload.orders)?payload.orders:[];
    const trades=Array.isArray(payload.trades)?payload.trades:[];
    const positions=Array.isArray(payload.positions)?payload.positions:[];
    const funding=Array.isArray(payload.funding)?payload.funding:[];
    const fees=Array.isArray(payload.fees)?payload.fees:[];
    const feeTotal=sumExact(fees.map(item=>item?.amountMicro));
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
    const firstExperiment=experiments[0];
    const killSwitch=paper.some(item=>item?.killSwitch===true);
    const firstNetPnL=firstExperiment?.attribution?.userNetPnl,firstRealized=firstExperiment?.attribution?.userRealizedPnl;
    const strategyRows=strategies.slice(0,5).map(item=>`<li><span>${esc(item.name||item.id||'Strategy')} · ${esc(item.stage||'stage unavailable')}</span><strong>${esc(item.family||'family unavailable')} · ${esc(String(item.strategyHash||'').slice(0,12)||'hash unavailable')}</strong></li>`).join('');
    const executionRows=executions.slice(0,5).map(item=>`<li><span>${esc(item.market||'Market')} · ${esc(item.side||'—')} · ${esc(item.venueStatus||'venue unknown')}</span><strong>${micro(item.amount)} @ ${micro(item.price,'YUSD_TEST')} · ${esc(item.venueOrderId||'order unavailable')}</strong></li>`).join('');
    const riskRows=mandates.slice(0,5).map(item=>`<li><span>${esc(item.market||label('Market','市场'))} · ${item.revoked?label('revoked','已撤销'):label('authorized','已授权')} · ${label('expires','到期')} ${esc(observedAt(item.expiresAt))}</span><strong>${label('notional','名义金额')} ${micro(item.maxNotional)} · ${label('loss','亏损上限')} ${micro(item.maxDailyLoss)} · ${label('slippage','滑点')} ${bps(item.maxSlippageBps)} · ${label('leverage','杠杆')} ${leverage(item.maxLeverageBps)}</strong></li>`).join('');
    return `<div class="source-details" aria-label="Live Quant account evidence"><div class="source-metrics"><div><small>Authorized strategies</small><strong>${strategies.length} strategies · ${active.length} active mandates</strong><span>${mandates.length-active.length} expired or revoked</span></div><div><small>First returned research PnL</small><strong>${micro(firstNetPnL,'YUSD_TEST')}</strong><span>${micro(firstRealized,'YUSD_TEST')} realized in that experiment; not portfolio PnL</span></div><div><small>Bounded testnet execution</small><strong>${executions.length} submitted · ${filled.length} filled</strong><span>Venue status is distinct from workflow submission</span></div><div><small>Risk state</small><strong>${killSwitch?'KILL SWITCH ACTIVE':'Kill switch clear'}</strong><span>${firstExperiment?`${bps(firstExperiment.metrics?.maxDrawdownBps)} research max drawdown in first returned experiment`:'No account-bound experiment'}</span></div></div><div class="source-evidence-grid"><div><h4>Strategy lifecycle</h4><ul>${strategyRows||'<li class="quiet">No account-authorized strategies.</li>'}</ul></div><div><h4>Authoritative executions</h4><ul>${executionRows||'<li class="quiet">No bounded testnet executions.</li>'}</ul></div><div><h4>Wallet-authorized risk limits</h4><ul>${riskRows||'<li class="quiet">No active or historical mandates.</li>'}</ul></div></div><small class="source-provenance">${esc(source.envelope.coverage||'Authorized Quant account evidence')} · as of ${esc(source.envelope.asOf||'unknown')} · ${experiments.length} research experiments · ${esc(payload.productVersion||source.status.version||'version unavailable')}</small></div>`;
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
  let lastSources=null;
  const renderReadSources=(sources)=>{
    const target=document.querySelector('#read-sources');
    const strategyTarget=document.querySelector('#strategy-read-sources');
    if(!target&&!strategyTarget)return;
    lastSources=sources;
    const values=Object.values(sources||{});
    if(target)target.innerHTML=values.length?values.map(source=>{
      const status=source.status||{},action=source.action||{},href=action.configured?safeActionURL(action.url):'';
      const stateText=({
        'owner-contract-pending':label('Owner contract pending. No product data inferred.','产品方合同待确认；不推断产品数据。'),
        'integration-unconfigured':label('Accepted contract, but no read endpoint is configured.','合同已接受，但尚未配置只读端点。'),
        'owner-endpoint-unavailable':label('Owner endpoint unavailable. No data substituted.','产品方端点不可用；不填入替代数据。'),
        'owner-response-rejected':label('Owner response rejected. No data substituted.','产品方响应被拒绝；不填入替代数据。'),
        'owner-evidence-rejected':label('Owner evidence failed validation. No data substituted.','产品方证据未通过核验；不填入替代数据。'),
      })[status.syncStatus]||label('No unsupported data inferred.','不推断未经支持的数据。');
      return `<div class="source-card"><div class="row"><div class="row-main"><strong>${esc(source.name||source.id||label('External source','外部来源'))}</strong><small>${esc(source.owner||label('owner unavailable','产品方未知'))} · ${esc(status.syncStatus||'owner-contract-pending')}</small><small>${status.available?esc(source.capability||label('Account-bound owner evidence','归属账户的产品方证据')):esc(stateText)}</small></div><div class="row-value"><span class="evidence">${source.ownerContractAccepted&&status.available?label('EVIDENCE AVAILABLE','证据可用'):label('UNAVAILABLE','不可用')}</span>${href?`<small><a href="${esc(href)}" target="_blank" rel="noreferrer noopener">${esc(action.label||label('Open owner product','打开产品页面'))}</a></small>`:`<small>${label('Owner action link not configured','产品方入口未配置')}</small>`}</div></div>${exchangeDetails(source)}${dexDetails(source)}${quantDetails(source)}</div>`;
    }).join(''):`<div class="empty compact">${label('No cross-product source registry was returned. No balances or performance figures are inferred.','未返回跨产品来源目录；不推断余额或收益数据。')}</div>`;
    if(strategyTarget){
      const quant=sources?.quant;
      strategyTarget.innerHTML=quant?.status?.available&&quant?.envelope?.payload
        ?quantDetails(quant)
        :`<div class="empty compact">${label('Authorized Quant strategy evidence is unavailable. No strategy, return, or execution is inferred.','已授权的 Quant 策略证据暂不可用；不推断策略、收益或执行。')}</div>`;
    }
  };
  render=(data)=>{baseRender(data);renderReadSources(data?.portfolio?.readSources||{})};
  document.addEventListener?.('finance:localechange',()=>{if(lastSources!==null)renderReadSources(lastSources)});
})();
