/* Independent client shell. UI preferences never carry service authority. */
(() => {
 'use strict';
 const $ = id => document.getElementById(id), I = window.NetworkI18n;
 const t = (key,params) => I ? I.t(key,params) : key;
 const routes = Object.freeze({overview:'网络总览',verify:'交易查证',history:'核验历史',node:'我的节点',participation:'质押与治理',contribution:'资源贡献',settings:'设置',account:'我的'});
 let activeRoute='overview', status=null, nodes=null, native=null, exported=null, theme='light', lastNotice=null;
 const media=window.matchMedia('(prefers-color-scheme: dark)');
 function put(id,key,params){const el=$(id);if(!el)return;el.removeAttribute('data-i18n');el.textContent=t(key,params);}
 function raw(id,value){const el=$(id);if(!el)return;el.removeAttribute('data-i18n');el.textContent=value===null||value===undefined?'—':String(value);}
 function say(key,error=false){lastNotice={key,error};const el=$('shell-notice');el.hidden=false;el.textContent=t(key);el.classList.toggle('error',error);}
 function short(value,n=6){if(!value)return '—';const s=String(value);return s.length>n*2+3?s.slice(0,n)+'…'+s.slice(-n):s;}
 function formatInteger(value){if(typeof value!=='string'||!/^\d+$/.test(value))return '—';try{return new Intl.NumberFormat(I.locale).format(BigInt(value));}catch{return value;}}
 function time(value){if(!value)return '—';const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(I.locale,{dateStyle:'short',timeStyle:'medium'}).format(d):'—';}
 function navigate(route,focus=false){if(!Object.hasOwn(routes,route))route='overview';activeRoute=route;for(const screen of document.querySelectorAll('[data-screen]'))screen.hidden=screen.dataset.screen!==route;for(const el of document.querySelectorAll('[data-route]')){const own=el.dataset.route;const mobileAccount=own==='account'&&['account','settings','history','participation'].includes(route);const selected=own===route||el.closest('.bottom-nav')&&mobileAccount;el.classList.toggle('active',!!selected);if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}document.querySelector('.topbar').dataset.route=route;put('screen-title',routes[route]);if(location.hash!=='#'+route)history.replaceState(null,'','#'+route);if(focus)$('screen-content').focus({preventScroll:true});window.scrollTo({top:0,behavior:'auto'});}
 function effectiveTheme(){return theme==='system'?(media.matches?'dark':'light'):theme;}
 function applyTheme(){document.documentElement.dataset.theme=effectiveTheme();$('theme-select').value=theme;const icon=$('theme-toggle').querySelector('.icon');icon.className='icon '+(effectiveTheme()==='dark'?'i-sun':'i-moon');document.querySelector('meta[name="theme-color"]').content=effectiveTheme()==='dark'?'#090b0f':'#f4f5fa';}
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
 function exportReceipt(){if(!exported)return;const record=structuredClone(exported);if(window.webkit?.messageHandlers?.networkExport){window.webkit.messageHandlers.networkExport.postMessage({version:'YNX-NETWORK-RECEIPT-EXPORT/v1',record});return;}const blob=new Blob([JSON.stringify({version:'YNX-NETWORK-LOCAL-RECEIPT-EXPORT/v1',historical:true,authority:false,receipt:record},null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ynx-network-receipt-'+record.receiptId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);say('已请求下载回执；导出记录不授予当前权限。');}
 for(const id of ['export-receipt','settings-export','account-export'])$(id).addEventListener('click',exportReceipt);
 window.addEventListener('network:export-result',event=>{const result=event.detail;if(result?.status==='saved')say('回执已保存；导出记录不授予当前权限。');else if(result?.status==='cancelled')say('已取消导出，原记录保留。');else if(result?.status==='failed')say('回执导出失败，原记录保留。',true);});
 function render(){
  const paired=status?.paired===true;
  put('connect-label',paired?'本机已连接':'连接本机');put('side-status',paired?'本机已连接':'本机未连接');$('side-dot').classList.toggle('good',paired);put('dash-connection',paired?'已连接':'未连接');$('dash-connection').classList.toggle('good-text',paired);put('dash-connection-note',paired?'本机查证服务':'等待本机配对');
  raw('settings-origin',location.origin);raw('settings-rpc',status?.rpc||null);raw('settings-version',status?.version?'YNX Network · '+status.version:'YNX Network · Local QA');put('settings-proof',status?.pqIndependentTrustConfigured===true||status?.anchorConfigured===true?'已配置，逐笔核验':'尚未配置');
  const label=$('language-select').selectedOptions?.[0]?.textContent||I.locale;raw('settings-language-label',label);
  const model=window.NetworkOverview.project(nodes,native);
  raw('dash-height',model.status?.height?formatInteger(model.status.height):null);
  raw('dash-validators',model.status?.readyValidatorCount!==null&&model.status?.readyValidatorCount!==undefined&&model.status?.validatorCount!==null?formatInteger(model.status.readyValidatorCount)+' / '+formatInteger(model.status.validatorCount):null);
  raw('dash-pending',model.status?.pendingTxCount===null?null:formatInteger(model.status?.pendingTxCount));
  raw('dash-source',model.source||status?.rpc||null);put('dash-sync',model.status?.catchingUp===false?'来源报告已同步':model.status?.catchingUp===true?'来源报告同步中':'尚未读取');
  put('side-height',model.status?.height?'RPC 报告高度 {height}':'连接后读取真实网络报告',{height:formatInteger(model.status?.height)});
  put('mobile-source-state',nodes?'固定 RPC 来源 · 尚非独立验证':'连接本机后读取 Testnet 数据');$('mobile-source-state').parentElement.classList.toggle('has-report',!!model.status);
  put('managed-node-state',model.native?.nodeControl==='unavailable'?'正式节点控制尚未开放':'尚未读取');
  put('resource-state',model.native?.resourceContribution==='disabled'?'已关闭':model.native?.resourceContribution==='unavailable'?'不可用':'默认关闭');
  const body=$('latest-block-rows');body.replaceChildren();
  if(model.latestBlock){const b=model.latestBlock,row=document.createElement('tr');for(const value of [formatInteger(b.height),short(b.hash),short(b.validator),formatInteger(b.transactionCount),time(b.time)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}else{const row=document.createElement('tr');row.className='empty-table-row';const cell=document.createElement('td');cell.colSpan=5;cell.textContent=t(paired?'本次未取得可绑定的最新区块。':'连接本机后显示实际最新区块');row.append(cell);body.append(row);}
  const list=$('validator-list');list.replaceChildren();const validators=model.validators;
  if(validators?.items?.length){for(const item of validators.items.slice(0,4)){const row=document.createElement('div');row.className='validator-item';const caption=document.createElement('div');caption.className='validator-caption';const name=document.createElement('strong');name.textContent=item.moniker||short(item.address);const share=document.createElement('small');const part=validators.distribution?.find(d=>d.address===item.address);share.textContent=part?new Intl.NumberFormat(I.locale,{maximumFractionDigits:2}).format(part.shareBps/100)+'%':'—';caption.append(name,share);const address=document.createElement('span');address.className='validator-address';address.textContent=item.address||'—';row.append(caption,address);if(part){const bar=document.createElement('progress');bar.max=10000;bar.value=part.shareBps;bar.setAttribute('aria-label',t('报告投票权占比'));row.append(bar);}list.append(row);}}else{const empty=document.createElement('p');empty.className='empty-state';empty.textContent=t(paired?'本次未取得验证者报告。':'尚未读取验证者');list.append(empty);}
  const mobile=$('validator-mobile');mobile.replaceChildren();
  if(validators?.distribution?.length){const strip=document.createElement('div');strip.className='distribution-strip';strip.setAttribute('aria-hidden','true');const legend=document.createElement('div');legend.className='distribution-legend';for(const part of validators.distribution.slice(0,4)){const segment=document.createElement('span');segment.style.flexGrow=String(part.shareBps);strip.append(segment);const name=document.createElement('span');name.textContent=(part.moniker||short(part.address,4))+' '+new Intl.NumberFormat(I.locale,{maximumFractionDigits:2}).format(part.shareBps/100)+'%';legend.append(name);}mobile.append(strip,legend);}else{const empty=document.createElement('p');empty.className='muted';empty.textContent=t('尚未读取验证者');mobile.append(empty);}
  for(const id of ['export-receipt','settings-export','account-export'])$(id).disabled=!paired||!exported;
 }
 window.NetworkUI=Object.freeze({receive(channel,value){if(channel==='status')status=value;else if(channel==='node')nodes=value;else if(channel==='native')native=value;else if(channel==='receipt'){exported=value?.record||null;if(value?.historical)navigate('verify',true);}else if(channel==='reset'){status=null;nodes=null;native=null;exported=null;}render();},navigate});
 I.subscribe(()=>{$('language-select').value=I.locale;put('screen-title',routes[activeRoute]);render();if(lastNotice)say(lastNotice.key,lastNotice.error);persistNativePreferences();window.NetworkClient?.rerenderLocale();});
 navigate(Object.hasOwn(routes,location.hash.slice(1))?location.hash.slice(1):'overview');render();
})();
