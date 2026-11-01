/* Independent client shell. UI preferences never carry service authority. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id), I = window.NetworkI18n;
 const t = (key,params) => I ? I.t(key,params) : key;
 const routes = Object.freeze({overview:'网络总览',verify:'交易查证',history:'核验历史',node:'我的节点',participation:'质押与治理',contribution:'资源贡献',settings:'设置',account:'我的'});
 let activeRoute='overview', status=null, nodes=null, native=null, exported=null, theme='light', lastNotice=null, exportBusy=false, networkPhase='idle', selectedBlockHash=null;
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 function put(id,key,params){const el=$(id);if(!el)return;el.removeAttribute('data-i18n');el.textContent=t(key,params);}
 function raw(id,value){const el=$(id);if(!el)return;el.removeAttribute('data-i18n');el.textContent=value===null||value===undefined?'—':String(value);}
 function say(key,error=false,params){lastNotice={key,error,params};const el=$('shell-notice');el.hidden=false;el.textContent=t(key,params);el.classList.toggle('error',error);}
 function short(value,n=6){if(!value)return '—';const s=String(value);return s.length>n*2+3?s.slice(0,n)+'…'+s.slice(-n):s;}
 function formatInteger(value){if(typeof value!=='string'||!/^\d+$/.test(value))return '—';try{return new Intl.NumberFormat(I.locale).format(BigInt(value));}catch{return value;}}
 function time(value){if(!value)return '—';const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(I.locale,{dateStyle:'short',timeStyle:'medium'}).format(d):'—';}
 function navigate(route,focus=false){if(!Object.hasOwn(routes,route))route='overview';activeRoute=route;for(const screen of document.querySelectorAll('[data-screen]'))screen.hidden=screen.dataset.screen!==route;for(const el of document.querySelectorAll('[data-route]')){const own=el.dataset.route;const mobileAccount=own==='account'&&['account','settings','history','participation'].includes(route);const selected=own===route||el.closest('.bottom-nav')&&mobileAccount;el.classList.toggle('active',!!selected);if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}document.querySelector('.topbar').dataset.route=route;put('screen-title',routes[route]);if(location.hash!=='#'+route)history.replaceState(null,'','#'+route);if(focus)$('screen-content').focus({preventScroll:true});window.scrollTo({top:0,behavior:'auto'});}
 function effectiveTheme(){return theme==='system'?(media.matches?'dark':'light'):theme;}
 function applyTheme(){document.documentElement.dataset.theme=effectiveTheme();$('theme-select').value=theme;const icon=$('theme-toggle').querySelector('.icon');icon.className='icon '+(effectiveTheme()==='dark'?'i-sun':'i-moon');document.querySelector('meta[name="theme-color"]').content=effectiveTheme()==='dark'?'#0c131e':'#ffffff';}
 function persistNativePreferences(){window.webkit?.messageHandlers?.networkPreferences?.postMessage({version:'YNX-NETWORK-UI-PREFERENCES/v1',locale:I.locale,theme});}
 function setTheme(value){if(!['light','dark','system'].includes(value))return;theme=value;try{localStorage.setItem('ynxNetworkTheme',theme);}catch{}applyTheme();persistNativePreferences();}
 try{const saved=localStorage.getItem('ynxNetworkTheme');if(['light','dark','system'].includes(saved))theme=saved;}catch{}
 applyTheme();media.addEventListener?.('change',()=>{if(theme==='system')applyTheme();});
 $('theme-toggle').addEventListener('click',()=>setTheme(effectiveTheme()==='light'?'dark':'light'));
 $('theme-select').addEventListener('change',event=>setTheme(event.target.value));
 $('language-select').value=I.locale;
 $('language-select').addEventListener('change',event=>I.setLocale(event.target.value));
 $('choose-language').addEventListener('click',()=>{$('language-select').focus();$('language-select').showPicker?.();});
 document.querySelectorAll('[data-route]').forEach(el=>el.addEventListener('click',()=>{navigate(el.dataset.route,true);if(el.dataset.settingsTarget)$(el.dataset.settingsTarget)?.scrollIntoView({block:'start'});}));
 window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
 $('connect-local').addEventListener('click',()=>{navigate('settings',true);$('connection-card').scrollIntoView({block:'center'});if(!status)$('pair-code').focus();});
 $('network-info').addEventListener('click',()=>{navigate('settings',true);});
 $('overview-refresh').addEventListener('click',()=>$('node-refresh').click());
 $('overview-block-details').addEventListener('click',()=>{document.querySelector('.overview-bottom').classList.add('show-reports');$('node-report-details').open=true;$('node-report-details').scrollIntoView({block:'start'});});
 $('show-raw').addEventListener('click',()=>{if($('raw-panel').hidden){say('本次尚无原始报告。');return;}$('raw-panel').open=true;$('raw-panel').scrollIntoView({block:'start'});});
 $('paste-tx').addEventListener('click',async()=>{try{if(!navigator.clipboard?.readText)throw Error('UNAVAILABLE');const value=(await navigator.clipboard.readText()).trim();if(!/^(0x)?[a-fA-F0-9]{64}$/.test(value)){say('剪贴板中没有完整交易哈希。',true);return;}$('tx-id').value=value;$('tx-id').dispatchEvent(new Event('input',{bubbles:true}));}catch{say('请在交易哈希输入框中手动粘贴。');$('tx-id').focus();}});
 for(const button of document.querySelectorAll('[data-history-filter]'))button.addEventListener('click',()=>{const value=button.dataset.historyFilter;document.querySelectorAll('[data-history-filter]').forEach(el=>el.classList.toggle('selected',el===button));window.NetworkClient?.setHistoryFilter(value);});
 function exportReceipt(){if(!exported||exportBusy||status?.paired!==true)return;const record=structuredClone(exported);if(window.webkit?.messageHandlers?.networkExport){exportBusy=true;say('请选择保存位置或取消；当前导出尚未完成。');render();try{window.webkit.messageHandlers.networkExport.postMessage({version:'YNX-NETWORK-RECEIPT-EXPORT/v1',record});}catch{exportBusy=false;say('回执导出失败，原记录保留。',true);render();}return;}const blob=new Blob([JSON.stringify({version:'YNX-NETWORK-LOCAL-RECEIPT-EXPORT/v1',historical:true,authority:false,receipt:record},null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ynx-network-receipt-'+record.receiptId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);say('已请求下载回执；导出记录不授予当前权限。');}
 for(const id of ['export-receipt','settings-export','account-export'])$(id).addEventListener('click',exportReceipt);
 window.addEventListener('network:export-result',event=>{const result=event.detail;if(!exportBusy)return;
  if(result?.status==='writing'){say('正在保存回执，请等待；当前导出尚未完成。');return;}
  if(result?.code==='EXPORT_BUSY')return;
  if(!['saved','cancelled','failed','unknown','idle'].includes(result?.status))return;
  exportBusy=false;
  if(result.status==='saved')say('回执已保存；导出记录不授予当前权限。');
  else if(result.status==='cancelled')say('已取消导出，原记录保留。');
  else if(result.status==='unknown')say('文件已写入，但持久化结果未确定；请核对原文件，勿重复导出。',true);
  else if(result.status==='idle')say('先前导出已结束；请核对原文件与记录。');
  else say('回执导出失败，原记录保留。',true);render();
 });
 function render(){
  const paired=status?.paired===true;
  put('connect-label',paired?'本机已连接':'连接本机');put('side-status',paired?'本机已连接':'本机未连接');$('side-dot').classList.toggle('good',paired);put('dash-connection',paired?'已连接':'未连接');$('dash-connection').classList.toggle('good-text',paired);put('dash-connection-note',paired?'本机查证服务':'等待本机配对');
  raw('settings-origin',location.origin);raw('settings-rpc',status?.rpc||null);raw('settings-version',status?.version?'YNX Network · '+status.version:'YNX Network · Local QA');put('settings-proof',status?.pqIndependentTrustConfigured===true||status?.anchorConfigured===true?'已配置，逐笔核验':'尚未配置');
  const label=$('language-select').selectedOptions?.[0]?.textContent||I.locale;raw('settings-language-label',label);
  const model=window.NetworkOverview.project(nodes,native);
  const age=model.receivedAt?Date.now()-Date.parse(model.receivedAt):null;
  const stale=age!==null&&(age>45000||age < -5000);
  put('network-data-status',!paired?'连接本机后读取 Testnet 数据':networkPhase==='loading'?'正在读取测试网数据…':networkPhase==='failed'?'RPC 暂不可用，请刷新重试。':stale?'网络报告已过期，请刷新。':networkPhase==='partial'?'部分 RPC 数据暂不可用。':nodes?'RPC 数据已更新；每 15 秒刷新。':'尚未读取');
  const metric=model.metrics;
  raw('dash-interval',metric?.averageBlockSeconds>0?new Intl.NumberFormat(I.locale,{maximumFractionDigits:3}).format(metric.averageBlockSeconds)+' s':null);
  put('dash-interval-note',metric?.intervals>0?'按最近 {count} 个区块间隔计算':'尚无连续区块样本',{count:metric?.intervals});
  raw('dash-updated-at',model.receivedAt?time(model.receivedAt):null);
  raw('dash-latency',model.statusLatencyMicros!==null&&model.statusLatencyMicros!==undefined?new Intl.NumberFormat(I.locale,{maximumFractionDigits:1}).format(Number(model.statusLatencyMicros)/1000)+' ms':null);
  raw('dash-tps',metric?.rpcSampleTPS!==null&&metric?.rpcSampleTPS!==undefined?new Intl.NumberFormat(I.locale,{maximumFractionDigits:3}).format(metric.rpcSampleTPS):null);
  raw('dash-height',model.status?.height?formatInteger(model.status.height):null);
  raw('dash-validators',model.status?.readyValidatorCount!==null&&model.status?.readyValidatorCount!==undefined&&model.status?.validatorCount!==null?formatInteger(model.status.readyValidatorCount)+' / '+formatInteger(model.status.validatorCount):null);
  raw('dash-pending',model.status?.pendingTxCount===null?null:formatInteger(model.status?.pendingTxCount));
  raw('dash-source',model.source||status?.rpc||null);put('dash-sync',model.status?.catchingUp===false?'来源报告已同步':model.status?.catchingUp===true?'来源报告同步中':'尚未读取');
  put('side-height',model.status?.height?'RPC 报告高度 {height}':'连接后读取真实网络报告',{height:formatInteger(model.status?.height)});
  put('mobile-source-state',nodes?'固定 RPC 来源 · 尚非独立验证':'连接本机后读取 Testnet 数据');$('mobile-source-state').parentElement.classList.toggle('has-report',!!model.status);
  const activity=model.native?.activity;
  const localNode=activity?.node, localParticipation=activity?.participation, localResource=activity?.resource;
  const localLabels={NOT_SUPPLIED:'未配置',UNAVAILABLE:'不可用',UNSUPPORTED:'当前版本不支持此操作。',REVOKED:'已撤销本机参与会话。',CONFIGURED:'已装配，仍需 Wallet 批准。',DISABLED:'已关闭',CONTROLLED_SANDBOX:'本机隔离测试中。',UNKNOWN:'结果未确定。'};
  const localLabel=value=>localLabels[value?.code]||(native?'不可用':'尚未读取');
  put('managed-node-state',localNode?localLabel(localNode):model.native?.nodeControl==='unavailable'?'正式节点控制尚未开放':native?'不可用':'尚未读取');
  raw('local-node-code',localNode?.code);raw('local-node-bytes',localNode?.capacityComplete===true&&localNode?.usedBytes!==null?formatInteger(localNode.usedBytes)+' B':null);
  const diagnostic=localNode?.diagnostics;
  raw('local-node-logs-state',diagnostic?.logs?.code);raw('local-node-stdout',diagnostic?.logs?.stdout?.text);raw('local-node-stderr',diagnostic?.logs?.stderr?.text);
  put('local-node-sync',diagnostic?'当前接口未提供':'尚未读取');
  put('local-node-recovery',diagnostic?.recovery?.priorEffectUnknown?'结果未确定。':diagnostic?.recovery?.processOwned?'本软件持有当前运行进程':'无运行任务');
  put('participation-state',localLabel(localParticipation));raw('participation-code',localParticipation?.code);raw('participation-entry-count',localParticipation?.entries===null||localParticipation?.entries===undefined?null:formatInteger(localParticipation.entries));raw('participation-unknown-count',localParticipation?.unknownEntries===null||localParticipation?.unknownEntries===undefined?null:formatInteger(localParticipation.unknownEntries));
  put('resource-state',localResource?localLabel(localResource):model.native?.resourceContribution==='disabled'?'已关闭':native?'不可用':'尚未读取');raw('resource-code',localResource?.code);
  put('resource-task-state',!localResource?localLabel(null):localResource.code==='UNKNOWN'?'结果未确定。':localResource.state==='running'?'本机隔离测试中。':localResource.state==='disabled'||localResource.state==='stopped'?'无运行任务':'不可用');
  raw('resource-verified-jobs',localResource?.verifiedJobs===null||localResource?.verifiedJobs===undefined?null:formatInteger(localResource.verifiedJobs));raw('resource-verified-bytes',localResource?.verifiedBytes===null||localResource?.verifiedBytes===undefined?null:formatInteger(localResource.verifiedBytes)+' B');raw('resource-active-workers',localResource?.activeWorkers===null||localResource?.activeWorkers===undefined?null:formatInteger(localResource.activeWorkers));
  const resourceSource=localResource?.source;
  put('resource-source-state',!resourceSource?'尚未读取':resourceSource.cleanupPending?'正在释放本机资源':resourceSource.code==='CURRENT'?'授权来源可用':resourceSource.code==='RETIRED'?'已停止':'授权来源未就绪');

  const body=$('latest-block-rows');body.replaceChildren();
  const blocks=model.recentBlocks?.length?model.recentBlocks:model.latestBlock?[model.latestBlock]:[];
  if(!blocks.some(b=>b.hash===selectedBlockHash)){selectedBlockHash=null;const panel=$('block-detail-panel');if(panel)panel.open=false;for(const id of ['height','hash','parent','time','validator','transactions'])raw('block-detail-'+id,null);}
  for(const b of blocks){const row=document.createElement('tr');for(const value of [formatInteger(b.height),short(b.hash),short(b.validator),formatInteger(b.transactionCount),time(b.time)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}const open=document.createElement('button');open.type='button';open.className='text-button';open.textContent=t('区块详情');open.addEventListener('click',()=>{selectedBlockHash=b.hash;for(const [id,v]of [['height',b.height],['hash',b.hash],['parent',b.parentHash],['time',b.time],['validator',b.validator],['transactions',b.transactionCount]])raw('block-detail-'+id,v);const panel=$('block-detail-panel');panel.open=true;panel.scrollIntoView?.({block:'nearest'});});const cell=document.createElement('td');cell.append(open);row.append(cell);body.append(row);}
  if(!blocks.length){const row=document.createElement('tr');row.className='empty-table-row';const cell=document.createElement('td');cell.colSpan=6;cell.textContent=t(paired?'本次未取得可绑定的最新区块。':'连接本机后显示实际最新区块');row.append(cell);body.append(row);}
  const txs=$('recent-transactions');if(txs){txs.replaceChildren();for(const tx of model.recentTransactions||[]){const row=document.createElement('button');row.type='button';row.className='history-row';row.textContent=short(tx.hash,12)+' · '+formatInteger(tx.height)+' · '+time(tx.time);row.addEventListener('click',()=>{navigate('verify',true);$('tx-id').value=tx.hash;$('tx-id').dispatchEvent(new Event('input',{bubbles:true}));$('lookup-button').click();});txs.append(row);}if(!model.recentTransactions?.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=t(model.transactionListsComplete?'所取回区块中没有交易。':'当前 RPC 未提供可展示的交易列表。');txs.append(empty);}}
  const list=$('validator-list');list.replaceChildren();const validators=model.validators;
  if(validators?.items?.length){for(const item of validators.items.slice(0,4)){const row=document.createElement('div');row.className='validator-item';const caption=document.createElement('div');caption.className='validator-caption';const name=document.createElement('strong');name.textContent=item.moniker||short(item.address);const share=document.createElement('small');const part=validators.distribution?.find(d=>d.address===item.address);share.textContent=part?new Intl.NumberFormat(I.locale,{maximumFractionDigits:2}).format(part.shareBps/100)+'%':'—';caption.append(name,share);const address=document.createElement('span');address.className='validator-address';address.textContent=item.address||'—';row.append(caption,address);if(part){const bar=document.createElement('progress');bar.max=10000;bar.value=part.shareBps;bar.setAttribute('aria-label',t('报告投票权占比'));row.append(bar);}list.append(row);}}else{const empty=document.createElement('p');empty.className='empty-state';empty.textContent=t(paired?'本次未取得验证者报告。':'尚未读取验证者');list.append(empty);}
  const mobile=$('validator-mobile');mobile.replaceChildren();
  if(validators?.distribution?.length){const strip=document.createElement('div');strip.className='distribution-strip';strip.setAttribute('aria-hidden','true');const legend=document.createElement('div');legend.className='distribution-legend';for(const part of validators.distribution.slice(0,4)){const segment=document.createElement('span');segment.style.flexGrow=String(part.shareBps);strip.append(segment);const name=document.createElement('span');name.textContent=(part.moniker||short(part.address,4))+' '+new Intl.NumberFormat(I.locale,{maximumFractionDigits:2}).format(part.shareBps/100)+'%';legend.append(name);}mobile.append(strip,legend);}else{const empty=document.createElement('p');empty.className='muted';empty.textContent=t('尚未读取验证者');mobile.append(empty);}
  for(const id of ['export-receipt','settings-export','account-export'])$(id).disabled=!paired||!exported||exportBusy;
 }
 window.NetworkUI=Object.freeze({receive(channel,value){if(channel==='status')status=value;else if(channel==='node')nodes=value;else if(channel==='networkState')networkPhase=value;else if(channel==='notice')say(value.key,value.error,value.params);else if(channel==='native')native=value;else if(channel==='receipt'){exported=value?.record||null;if(value?.historical)navigate('verify',true);}else if(channel==='reset'){status=null;nodes=null;native=null;exported=null;networkPhase='idle';}render();},navigate});
 I.subscribe(()=>{$('language-select').value=I.locale;put('screen-title',routes[activeRoute]);render();if(lastNotice)say(lastNotice.key,lastNotice.error,lastNotice.params);persistNativePreferences();window.NetworkClient?.rerenderLocale();});
 navigate(Object.hasOwn(routes,location.hash.slice(1))?location.hash.slice(1):'overview');render();
})();
