import {mountDesktopAgentDelegations} from './desktop-agent-delegations-ui.mjs';
import {createDesktopOverviewActivityUI} from './desktop-overview-activity-ui.mjs';
import {desktopNetworkDisplay} from './desktop-network-display.mjs';
import {createAddressResolverUI} from './receive-address-resolver-ui.mjs';
const address=value=>typeof value==='string'&&/^ynx1[a-z0-9]{38}$/.test(value)?value:null;
/** Public display projection only. Never examines inputs, backups or keys. */
export function projectDesktopPublicState(account,key){
 const canonical=typeof account?.account==='string'&&/^0x[a-f0-9]{40}$/.test(account.account)?account.account:null;
 const native=address(account?.ynxAccount),initialized=account?.initialized===true&&canonical!==null;
 return Object.freeze({initialized,canonical,native,locked:key?.locked!==false,authenticating:key?.authenticating===true,revision:key?.revision??null,available:account!==null&&typeof account==='object',passwordConfigured:account?.passwordConfigured===true});
}
export function createApprovedDesktopUI({document:doc,api,navigate,unlock,openImport,openCrossChain,openNetworks,reviewPending,writeClipboard,agentManagement=null}){
 const byId=id=>doc.getElementById(id),zh=()=>doc.documentElement.lang.startsWith('zh'),t=(en,cn)=>zh()?cn:en;
 let overviewActivity=null,keyOwner=null;
 let scope=null,entered=false,disposed=false,policyEpoch=0,policyBusy=false,pending={count:0,ai:false},networkState=null;
 const resolver=createAddressResolverUI({root:byId('desktop-resolver-root'),api,getContext:()=>({open:doc.querySelector('[data-panel="resolver"]')?.hidden===false,account:scope?.canonical??null,keyRevision:scope?.revision,networkId:'ynx_6423-1'}),writeClipboard});
 const agentDelegations=mountDesktopAgentDelegations({root:byId('desktop-agent-delegations'),document:doc,getContext:()=>({account:scope?.canonical===keyOwner?scope.canonical:null,revision:scope?.revision,locked:scope?.locked!==false,focused:doc.hasFocus?.()!==false}),management:agentManagement,reviewPending});
 const move=(id,target)=>{const n=byId(id),parent=byId(target);if(n&&parent)parent.append(n);};
 move('transaction-history','desktop-history-slot');move('walletconnect-sessions','desktop-permission-slot');
 for(const id of ['pq-key-preparation','pq-account-initial','pq-independent-backup','pq-registered-restore','pq-migration-form','pq-revocation-form'])move(id,'desktop-pq-tools-slot');
 // Reparent the real asset DOM instead of duplicating balances or callbacks.
 const assets=byId('assets'),heading=doc.querySelector('.asset-heading'),row=doc.querySelector('.asset-row'),note=doc.querySelector('.overview-note');
 if(assets&&heading&&row){const layout=doc.createElement('div'),left=doc.createElement('section'),right=doc.createElement('aside');layout.className='desktop-assets-layout';right.className='desktop-assets-sidebar';layout.append(left,right);assets.append(layout);left.append(heading,row);if(note)right.append(note);const card=doc.createElement('section'),title=doc.createElement('h3'),body=doc.createElement('p'),button=doc.createElement('button');card.className='desktop-panel';title.textContent=t('Security and original approvals','安全与原始批准');body.textContent=t('Dual signatures require ML-DSA-87 and SLH-DSA-SHA2-256f. Local custody, registration and each protected request are checked separately.','双签要求 ML-DSA-87 与 SLH-DSA-SHA2-256f；本地密钥、登记和每次受保护请求分别核对。');button.type='button';button.textContent=t('Open security center','打开安全中心');button.addEventListener('click',()=>route('security'));card.append(title,body,button);overviewActivity=createDesktopOverviewActivityUI({document:doc,parent:right,securityCard:card,getContext:()=>({account:scope?.canonical===keyOwner?scope.canonical:null,revision:scope?.revision,locked:scope?.locked!==false}),reviewPending,openHistory:()=>route('history')});}
 const missing=[];if(typeof api.exportPQBackup!=='function')missing.push(t('encrypted PQ backup','PQ 加密备份'));if(typeof api.restoreRegisteredPQ!=='function')missing.push(t('registered-key recovery','已登记密钥恢复'));if(missing.length){const unavailable=doc.createElement('p');unavailable.className='desktop-warning';unavailable.setAttribute('role','status');unavailable.textContent=t('Unavailable in this build: ','当前版本不可用：')+missing.join(' · ');byId('desktop-pq-tools-slot').before?.(unavailable);}
 function translate(){for(const node of doc.querySelectorAll('[data-desktop-en]'))node.textContent=zh()?node.dataset.desktopZh??node.dataset.desktopEn:node.dataset.desktopEn;}
 function resetPolicy(){policyEpoch++;policyBusy=false;byId('desktop-pq-a').textContent=byId('desktop-pq-b').textContent=t('Not checked','未核对');byId('desktop-pq-policy').textContent=t('Check the current original policy. Local keys and registration are separate.','请核对当前原链上授权；本地密钥与链上登记分别确认。');}
 function viewChanged(name){
  if(name==='connections'||name==='permissions'){const target=name==='connections'?'desktop-connection-sessions-slot':'desktop-permission-slot';move('walletconnect-detail',target);move('walletconnect-sessions',target);}
  const titles={overview:['Assets','资产'],history:['Transactions','交易'],connections:['DApp','DApp'],security:['Security center','安全中心'],agents:['AI Agent','AI Agent'],permissions:['Permissions','授权管理'],accounts:['Accounts & backup','账户与备份'],resolver:['Address Resolver','地址格式转换'],settings:['Settings','设置']};
  if(name==='agents')void agentDelegations.refresh();
  if(titles[name])byId('page-title').textContent=t(...titles[name]);resolver.invalidate();
 }
 function enterWorkspace(){entered=true;byId('desktop-welcome').hidden=true;byId('desktop-lock-screen').hidden=true;doc.body.dataset.walletStage='workspace';}
 function route(name){enterWorkspace();navigate(name);}
 function openPQ(id){route('security');const details=byId('desktop-pq-tools');details.open=true;byId(id)?.scrollIntoView?.({block:'start',behavior:'smooth'});}
 byId('desktop-start-ynx').addEventListener('click',()=>{route('accounts');if(scope?.locked)unlock();});
 byId('desktop-import-family').addEventListener('click',()=>{route('accounts');if(scope?.locked)unlock();else openImport();});
 byId('desktop-restore-ynx').addEventListener('click',()=>openPQ('pq-registered-restore'));
 byId('desktop-browse').addEventListener('click',()=>route('accounts'));
 byId('desktop-unlock').addEventListener('click',unlock);byId('desktop-locked-accounts').addEventListener('click',()=>route('accounts'));
 byId('desktop-open-crosschain').disabled=!api.crossChain;byId('desktop-open-crosschain').addEventListener('click',()=>openCrossChain?.());
 for(const button of doc.querySelectorAll('[data-desktop-action]'))button.addEventListener('click',()=>{
  const action=button.dataset.desktopAction;
  if(action==='pq-backup')openPQ('pq-independent-backup');else if(action==='pq-restore')openPQ('pq-registered-restore');else if(action==='appearance')byId('open-appearance').click();else if(action==='networks')openNetworks?.();else if(action==='family')byId('open-family')?.click();else if(action==='pay')byId('open-native-pay')?.click();else if(action==='lock')byId('lock-wallet').click();
 });
 byId('desktop-agent-review').addEventListener('click',()=>{if(pending.count>0&&!scope?.locked)reviewPending();});
 byId('desktop-read-pq-policy').addEventListener('click',async()=>{
  if(policyBusy||!scope?.canonical||scope.locked||typeof api.pqAccountAuthorization!=='function')return;const before=scope,token=++policyEpoch;policyBusy=true;byId('desktop-read-pq-policy').disabled=true;
  byId('desktop-pq-policy').textContent=t('Reading original account policy…','正在核对原账户链上授权…');
  try{const reply=await api.pqAccountAuthorization();if(disposed||token!==policyEpoch||scope?.canonical!==before.canonical||scope?.revision!==before.revision||scope.locked)return;const v=reply?.value,names={active:['Active on chain','链上已生效'],pending_activation:['Pending activation','链上待生效'],revocation_pending:['Revocation pending','撤销待生效'],revoked:['Revoked','已撤销'],legacy:['Not registered','未登记']};
   if(reply?.ok!==true||v?.account!==before.canonical||v.readOnly!==true||v.signingAuthorized!==false||!names[v.authorizationStatus])throw Error('Unconfirmed policy');
   byId('desktop-pq-a').textContent=byId('desktop-pq-b').textContent=t(...names[v.authorizationStatus]);byId('desktop-pq-policy').textContent=t('Original on-chain policy observed; local key custody, backups and each signature remain separately checked.','已观察原链上授权；本地密钥、备份与每次签名仍须分别核对。');
  }catch{if(token===policyEpoch)byId('desktop-pq-policy').textContent=t('Original authorization unavailable. No active state is inferred.','原链上授权尚无法确认；不推断已生效。');}
  finally{if(token===policyEpoch){policyBusy=false;byId('desktop-read-pq-policy').disabled=scope?.locked||!scope?.canonical;}}
 });
 function updatePending(value){overviewActivity?.updatePending(value?.overview);pending={count:Number.isSafeInteger(value?.count)&&value.count>=0?value.count:0,ai:value?.ai===true};byId('desktop-agent-pending').textContent=pending.count? t(pending.ai?'An original AI task request awaits independent review.':'Original requests await independent review.','有原始请求待独立核对。'):t('No pending request has been supplied. Delegation activity is not inferred.','当前没有已供给的待核对请求；不推断委托活动。');byId('desktop-agent-review').disabled=!pending.count||scope?.locked!==false;}
 function render(account,key){
  keyOwner=key?.account??null;
  const next=projectDesktopPublicState(account,key),changed=!scope||next.canonical!==scope.canonical||next.revision!==scope.revision||next.locked!==scope.locked;
  if(scope?.locked===false&&next.locked)entered=false;
  if(changed){if(next.locked||scope?.canonical!==next.canonical)pending={count:0,ai:false};resetPolicy();resolver.invalidate();byId('desktop-history-detail')?.replaceChildren();}scope=next;overviewActivity?.updateContext();agentDelegations.updateContext();doc.body.dataset.walletLocked=String(next.locked);
  const welcome=byId('desktop-welcome'),lock=byId('desktop-lock-screen');
  if(!entered&&!next.initialized){welcome.hidden=false;lock.hidden=true;doc.body.dataset.walletStage='welcome';}
  else if(!entered&&next.locked&&next.initialized){welcome.hidden=true;lock.hidden=false;doc.body.dataset.walletStage='locked';}
  else{welcome.hidden=true;lock.hidden=true;doc.body.dataset.walletStage='workspace';}
  byId('desktop-welcome-status').textContent=next.available?t('Choose the correct account and backup type. YNX registered-key recovery requires an existing registered account.','请选择正确账户与备份类型；YNX 原密钥恢复要求已有已登记账户。'):t('Local account status unavailable. Existing data is retained; reopen Wallet before continuing.','本地账户状态尚不可用；原数据保留，请重新打开钱包后继续。');
  for(const id of ['desktop-start-ynx','desktop-import-family','desktop-restore-ynx'])byId(id).disabled=!next.available||next.authenticating;
  byId('desktop-lock-account').textContent=next.native??next.canonical??'—';byId('desktop-lock-status').textContent=t('Enter the local password in the protected Wallet form.','请在钱包受控表单中输入本地密码。');byId('desktop-unlock').disabled=next.authenticating||key?.unlockAvailable!==true;
  byId('desktop-read-pq-policy').disabled=policyBusy||next.locked||!next.canonical||typeof api.pqAccountAuthorization!=='function';
  updatePending(pending);
 }
 function renderNetwork(){if(!networkState)return;const view=desktopNetworkDisplay(networkState,zh()),chip=byId('desktop-network-chip');chip.textContent=view.label;chip.title=view.detail;chip.dataset.networkState=view.known?'available':'unavailable';}
 const observer=typeof MutationObserver==='function'?new MutationObserver(()=>{translate();renderNetwork();overviewActivity?.render();agentDelegations.refreshLanguage();resolver.refreshLanguage();}):null;observer?.observe(doc.documentElement,{attributes:true,attributeFilter:['lang']});translate();updatePending(pending);
 return Object.freeze({render,viewChanged,enterWorkspace,updatePending,updateHistory:(view,actor)=>overviewActivity?.updateHistory(view,actor),showHistoryRecord(record){
  const parent=byId('desktop-history-detail');if(!parent||record?.account!==scope?.canonical)return;parent.replaceChildren();
  const h=doc.createElement('h2'),amount=doc.createElement('p'),facts=doc.createElement('dl'),notice=doc.createElement('p');
  h.textContent=record.successful?t('Transfer observed locally','本地快照已观察到交易'):t('Execution failed','执行失败');amount.className='desktop-history-amount';amount.textContent=record.amount+' YNXT';
  for(const [en,cn,value]of [['Canonical recipient ID','接收方规范 ID',record.to],['Transaction hash','交易哈希',record.hash],['Actual fee','实际手续费',record.actualFee+' YNXT'],['Observed block','观察区块',record.blockNumber]]){const term=doc.createElement('dt'),valueNode=doc.createElement('dd');term.textContent=t(en,cn);valueNode.textContent=String(value);valueNode.dir='ltr';facts.append(term,valueNode);}
  notice.textContent=t('This is the retained verified local snapshot. Independent consensus finality is not supplied. An UNKNOWN operation must never be replayed.','这是已保留且经核对的本地快照；尚未供给独立共识最终性。结果未知的原操作不得重发。');parent.append(h,amount,facts,notice);
 },updateNetwork(value){networkState={available:value?.available===true,chainId:value?.chainId};renderNetwork();},invalidate:()=>resolver.invalidate(),dispose(){disposed=true;agentDelegations.dispose();overviewActivity?.dispose();policyEpoch++;resolver.destroy();observer?.disconnect();}});
}
