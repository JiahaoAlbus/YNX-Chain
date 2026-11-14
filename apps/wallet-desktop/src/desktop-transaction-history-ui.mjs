import {setWalletCopy} from './wallet-locale.mjs';
/** Only accepts the existing history controller's verified public projection.
 * No query, receipt validation, signature, recovery or replay is performed here. */
export function createDesktopTransactionHistoryUI({document:doc,getContext,nativeAccountLabel=x=>x,writeClipboard}){
 const byId=id=>doc.getElementById(id),t=en=>en;
 let epoch=0,rows=[],selected=null,context=null,retained=false,disposed=false;
 const make=(tag,text,cls,values)=>{const n=doc.createElement(tag);if(text!==undefined)setWalletCopy(n,text,values);if(cls)n.className=cls;return n;};
 const raw=(tag,text,cls)=>{const n=doc.createElement(tag);n.textContent=String(text);if(cls)n.className=cls;return n;};
 const live=before=>{const now=getContext();return !disposed&&now.account===before.account&&now.revision===before.revision;};
 function empty(){const target=byId('desktop-history-detail');target.replaceChildren(make('h2',t('Transaction details','交易详情')),make('p',t('Select an actual retained transfer to see its details.','选择实际保留的转账记录以查看详情。')));}
 function detail(record){
  const target=byId('desktop-history-detail');target.replaceChildren();
  const heading=make('div',undefined,'desktop-history-heading'),title=make('h2',t('Send YNXT','发送 YNXT')),state=make('span',record.successful?t('Mined locally','本地已出块'):t('Execution failed','执行失败'),'desktop-history-state');
  heading.append(title,state);target.append(heading,raw('p',(record.successful?'−':'')+record.amount+' YNXT','desktop-history-amount'));
  if(!record.successful)target.append(make('p',t('Requested amount; this failed transfer is not shown as an outgoing payment.','这是请求金额；执行失败的转账不显示为已付款。'),'desktop-history-notice'));
  const facts=make('dl',undefined,'desktop-history-facts');
  const pairs=[[t('Status','状态'),record.successful?t('Observed in local snapshot','本地快照已观察'):t('Failed in local snapshot','本地快照执行失败')],[t('Network','网络'),'YNX Testnet'],[t('From','从'),nativeAccountLabel(record.account)],[t('To','到'),nativeAccountLabel(record.to)],[t('Transaction hash','交易哈希'),record.hash],[t('Actual fee','实际手续费'),record.actualFee+' YNXT'],[t('Observed block','观察区块'),record.blockNumber]];
  for(const [index,[label,value]]of pairs.entries()){const term=make('dt',label),data=index===0?make('dd',value):raw('dd',value);data.dir='ltr';facts.append(term,data);}target.append(facts);
  const actions=make('div',undefined,'desktop-history-actions'),feedback=make('p',undefined,'desktop-history-copy-status');feedback.setAttribute('role','status');
  for(const [label,value]of [[t('Copy transaction hash','复制交易哈希'),record.hash],[t('Copy recipient ID','复制接收方 ID'),record.to]]){
   const button=make('button',label);button.type='button';button.disabled=typeof writeClipboard!=='function';
   button.addEventListener('click',async()=>{const before=getContext(),token=epoch;if(!live(before)||record.account!==before.account||context?.revision!==before.revision||!rows.includes(record)||selected!==record.hash)return;button.disabled=true;try{const copied=await writeClipboard(value,()=>token===epoch&&live(before)&&selected===record.hash&&rows.includes(record));if(token===epoch&&live(before)&&copied!==false)setWalletCopy(feedback,t('Copied.','已复制。'));}catch{if(token===epoch&&live(before))setWalletCopy(feedback,t('Copy unavailable. Select and copy the displayed value.','无法复制，请选择并复制显示的内容。'));}finally{if(token===epoch&&live(before))button.disabled=false;}});actions.append(button);
  }
  target.append(actions,feedback,make('p',t('Retained local snapshot only. Independent consensus finality and signature verification are not supplied here. Unresolved transactions remain in their original recovery panel; never resend an UNKNOWN operation.','这里只展示保留的本地快照，未供给独立共识最终性或签名验证。未解决交易仍在原恢复面板，结果未知的原操作不得重发。'),'desktop-history-notice'));
  if(retained)target.append(make('p',t('Refresh did not complete. These are previously verified records retained on this device.','刷新尚未完成；当前显示此设备之前核对并保留的记录。'),'desktop-warning'));
 }
 function paint(){const list=byId('transaction-history-list');list.replaceChildren();for(const record of rows){const button=make('button',undefined,'desktop-history-item');button.type='button';button.setAttribute('aria-pressed',String(selected===record.hash));const icon=make('span',record.successful?'↗':'×','desktop-history-icon');icon.setAttribute('aria-hidden','true');const body=make('span',undefined,'desktop-history-item-body');body.append(make('strong',t('Send YNXT','发送 YNXT')),record.successful?make('span','Local snapshot · block {block}',undefined,{block:record.blockNumber}):make('span',t('Execution failed','执行失败')));button.append(icon,body,raw('strong',(record.successful?'−':'')+record.amount+' YNXT'));button.addEventListener('click',()=>{if(!context||!live(context)||!rows.includes(record))return;epoch++;selected=record.hash;paint();});list.append(button);}const record=rows.find(r=>r.hash===selected);if(record)detail(record);else empty();}
 return Object.freeze({render(view){
  const now=getContext();if(disposed)return;
  if(!context||context.account!==now.account||context.revision!==now.revision){epoch++;selected=null;}context={account:now.account,revision:now.revision};
  rows=Array.isArray(view.records)?view.records.filter(r=>r.account===now.account):[];
  retained=rows.length>0&&(view.busy===true||view.error!=null);if(!rows.some(r=>r.hash===selected))selected=rows[0]?.hash??null;
  const status=byId('transaction-history-status');setWalletCopy(status,view.error?t('History refresh unavailable. Original records remain on this device.','无法刷新交易历史；此设备的原记录仍保留。'):view.busy?t('Reading saved transactions…','正在读取已保存交易…'):view.loaded&&rows.length===0?t('No verified completed transfers for this account on this device.','此设备没有该账户经核对的已完成转账。'):'');
  byId('transaction-history-list').setAttribute('aria-busy',String(view.busy===true));byId('refresh-transaction-history').disabled=view.busy||!now.account;byId('older-transaction-history').hidden=view.nextCursor===null;byId('older-transaction-history').disabled=view.busy;
  paint();
 },invalidate(){epoch++;rows=[];selected=null;context=null;byId('transaction-history-list').replaceChildren();empty();},dispose(){disposed=true;epoch++;rows=[];selected=null;}});
}
