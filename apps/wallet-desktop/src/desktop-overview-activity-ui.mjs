// Existing Wallet queue/history presentation only. No request, grant, balance,
// signature or finality is inferred from these read-only local observations.
export function createDesktopOverviewActivityUI({document:doc,parent,securityCard,getContext,reviewPending,openHistory}){
 const make=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;},zh=()=>doc.documentElement.lang.startsWith('zh'),t=(en,cn)=>zh()?cn:en;
 const pendingCard=make('section',undefined,'desktop-panel desktop-overview-pending'),recentCard=make('section',undefined,'desktop-panel desktop-overview-recent');pendingCard.setAttribute('aria-live','polite');recentCard.setAttribute('aria-live','polite');parent.append(pendingCard,securityCard,recentCard);
 let actor=null,queued=null,history=null,disposed=false;
 const same=(a,b)=>a&&b&&a.account===b.account&&a.revision===b.revision&&a.locked===b.locked;
 const current=before=>!disposed&&same(before,getContext())&&!before.locked&&!!before.account;
 function updateContext(){const next=getContext();if(!same(actor,next)){actor={account:next.account,revision:next.revision,locked:next.locked};queued=null;history=null;}render();}
 function render(){if(disposed)return;pendingCard.replaceChildren(make('h3',t('Pending review','待核对请求')));recentCard.replaceChildren(make('h3',t('Recent activity','最近活动')));
  if(!actor?.account||actor.locked){pendingCard.append(make('p',t('Unlock the selected account to inspect its local requests.','解锁当前账户以查看本地请求。')));recentCard.append(make('p',t('Unlock the selected account to inspect saved activity.','解锁当前账户以查看已保存活动。')));return;}
  if(!queued)pendingCard.append(make('p',t('Current local queue has not been observed.','尚未观察当前本地队列。')));
  else{const line=make('p',queued.matchingCount?t(`${queued.matchingCount} original request(s) queued for this account.`,`${queued.matchingCount} 个此账户原始请求待核对。`):t('No request is currently queued for this account.','此账户当前本地队列没有请求。'));pendingCard.append(line);if(queued.unassignedCount)pendingCard.append(make('p',t('Other queued requests still need account association.','其他队列请求仍需核对账户关联。')));const button=make('button',t('Review original requests','查看原始请求'));button.type='button';button.disabled=queued.matchingCount===0&&queued.unassignedCount===0;const before={...actor};button.addEventListener('click',()=>{if(current(before))reviewPending();});pendingCard.append(button);}
  pendingCard.append(make('p',t('Local queue only. Requests still held by an app or an unavailable peer are not counted.','仅统计本地队列；应用或不可用连接仍持有的请求未计入。'),'desktop-overview-caption'));
  if(!history)recentCard.append(make('p',t('Saved activity has not been read for this account.','尚未读取此账户的已保存活动。')));
  else{const rows=history.records.slice(0,3);for(const record of rows){const row=make('div',undefined,'desktop-overview-activity-row'),info=make('div'),amount=make('strong',(record.successful?'−':'')+record.amount+' YNXT');info.append(make('strong',record.successful?t('Send YNXT','发送 YNXT'):t('Transfer execution failed','转账执行失败')),make('span',t('Local snapshot · block ','本地快照 · 区块 ')+record.blockNumber));row.append(info,amount);recentCard.append(row);}
   if(history.error)recentCard.append(make('p',rows.length?t('Refresh unavailable; showing previously verified records.','无法刷新，显示之前已核对的记录。'):t('Saved history could not be read. Original records remain on this device.','无法读取已保存历史；原记录仍保留在此设备。'),'desktop-warning'));
   else if(history.busy)recentCard.append(make('p',rows.length?t('Refreshing; these records are retained snapshots.','正在刷新；以上为保留快照。'):t('Reading saved activity…','正在读取已保存活动…')));
   else if(!history.loaded&&rows.length===0)recentCard.append(make('p',t('Saved activity has not been verified.','已保存活动尚未核对。')));
   else if(history.loaded&&rows.length===0)recentCard.append(make('p',t('No verified completed transfers saved for this account.','此账户没有已保存且经核对的已完成转账。')));
  }
  const all=make('button',t('View all transactions','查看全部交易'));all.type='button';all.className='text-button';const before={...actor};all.addEventListener('click',()=>{if(current(before))openHistory();});recentCard.append(all,make('p',t('Local outgoing snapshots only; UNKNOWN operations stay in their original recovery panel. Independent consensus finality is not supplied.','仅本地转出快照；结果未知的操作保留在原恢复面板。未供给独立共识最终性。'),'desktop-overview-caption'));
 }
 function updatePending(value){if(!current(actor)||value?.account!==actor.account||value.revision!==actor.revision)return;const counts=[value.matchingCount,value.unassignedCount];queued=counts.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=65)?{matchingCount:counts[0],unassignedCount:counts[1]}:null;render();}
 function updateHistory(view,sourceActor){if(!current(actor)||sourceActor?.account!==actor.account||sourceActor.revision!==actor.revision)return;
  const records=Array.isArray(view?.records)?view.records:null;
  if(!records||records.some(r=>r?.account!==actor.account||r.confirmed!==true||r.confirmationScope!=='local-snapshot'||r.consensusFinality!==false||typeof r.successful!=='boolean'||typeof r.amount!=='string'||!/^(0|[1-9][0-9]*)\.[0-9]{1,18}$/.test(r.amount)||typeof r.blockNumber!=='string'||!/^0x[0-9a-f]+$/.test(r.blockNumber))){history={records:history?.records??[],loaded:false,busy:false,error:true};render();return;}
  history={records:records.map(r=>({account:r.account,successful:r.successful,amount:r.amount,blockNumber:r.blockNumber})),busy:view.busy===true,error:view.error!=null,loaded:view.loaded===true};render();
 }
 updateContext();return Object.freeze({updateContext,updatePending,updateHistory,render,dispose(){disposed=true;queued=null;history=null;pendingCard.replaceChildren();recentCard.replaceChildren();}});
}
