'use strict';
const $ = id => document.getElementById(id);
const tr = (key, params) => typeof window !== 'undefined' && window.NetworkI18n ? window.NetworkI18n.t(key, params) : String(key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? '{'+k+'}'));
const textBindings = new Map();
function paint(el, key, params) { const render=typeof key==='function'?key:()=>tr(key,params); textBindings.set(el,render); el.removeAttribute?.('data-i18n'); el.textContent=render(); }
function publish(channel,value) { if(typeof window !== 'undefined')window.NetworkUI?.receive(channel,value); }
let historyFilter='all';
const reasonMessages=Object.freeze({NOT_SUPPLIED:'独立证明或信任材料尚未提供。',BAD_PROOF:'证明未通过核验，原始原因见交易详情。',CANCELLED:'本次核验已取消或超时。',REVOKED:'本机证明通道已关闭。',STATE_NOT_PROVEN:'资金、账户与发票状态尚未验证；ABCI 成功不等于到账证明'});
const reasonText=view=>tr(reasonMessages[view.reason]||view.detail||'未提供');
const levels = ['RPC_ONLY', 'HEADER_VERIFIED', 'INCLUSION_VERIFIED', 'STATE_VERIFIED'];
const pending = new Map();
let ticket = sessionStorage.getItem('ynxNetworkTicket') || '';
let epoch = 0;
let paired = false;
let expiryTimer;
let receiptRows = [];
let historyPage = 0;
const PAGE_SIZE = 20;
const txKey = value => String(value || '').trim().toLowerCase().replace(/^0x/, '');
function canonicalTx(value) { const hash = txKey(value); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_TX_ID'); return '0x' + hash; }
function receiptID(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('INVALID_RECEIPT_ID'); return value; }
function text(id, value, params) { paint($(id), value, params); }
function notice(value, error = false, params) { text('notice', value, params); $('notice').classList.toggle('error', error); publish('notice',{key:value,error,params}); }
function controls() {
  for (const id of ['proof-file']) $(id).disabled = !paired;
  for (const [id,channel] of [['lookup-button','receipt'],['history-open','receipt'],['node-refresh','node'],['overview-refresh','node'],['native-refresh','native'],['participation-refresh','native'],['resource-refresh','native'],['history-refresh','history']]) $(id).disabled = !paired || pending.has(channel);
  $('pair-form').hidden = paired;
  $('revoke').hidden = !paired;
  $('history-prev').disabled = !paired || historyPage === 0;
  $('history-next').disabled = !paired || (historyPage + 1) * PAGE_SIZE >= receiptRows.filter(row=>historyFilter==='all'||historyFilter==='verified'&&row.reportedLevel!=='RPC_ONLY'||row.reportedLevel===historyFilter).length;
}
function abort(channel) { const op = pending.get(channel); if (op) op.controller.abort(); pending.delete(channel); }
function abortAll() { for (const op of pending.values()) op.controller.abort(); pending.clear(); }
function begin(channel, options = {}) {
  abort(channel);
  const op = { channel, epoch, ticket, controller: new AbortController(), ...options };
  pending.set(channel, op);
  controls();
  return op;
}
function current(op) {
  return pending.get(op.channel) === op && !op.controller.signal.aborted && op.epoch === epoch && op.ticket === ticket &&
    (!op.requiresPair || paired) && (!op.txId || txKey($('tx-id').value) === txKey(op.txId));
}
function finish(op) { if (pending.get(op.channel) === op) pending.delete(op.channel); controls(); }
function invalidateEvidence(message) {
  publish('receipt',null); abort('receipt');
  text('level-tag', '尚未查询'); $('level-tag').className = 'tag neutral';
  document.querySelectorAll('.levels li').forEach((row, index) => {
    row.classList.remove('reached', 'reported');
    paint(row.querySelector('.step-status'), index === 0 ? '待查询' : index === 3 ? '等待状态证明' : '缺少证据');
  });
  $('evidence-meta').hidden = true;
  for (const id of ['meta-tx', 'meta-level', 'meta-source', 'meta-height', 'meta-reason', 'meta-receipt', 'meta-time', 'meta-context', 'raw-report']) text(id, '');
  $('raw-panel').hidden = true;
  text('execution-result', '尚未验证确定性 ABCI 执行结果');
  text('member-result', '尚未验证指定成员的执行结果');
  text('funds-result', '尚未验证资金、账户或发票状态');
  text('collection-report', '裸交易报告：未查询');
  text('collection-proof', '证明来源：未查询');
  if (message) notice(message);
  controls();
}
function clearPanels() {
  window.NetworkOperations?.reset();
  publish('reset',null);
  receiptRows = []; historyPage = 0;
  $('receipt-list').replaceChildren();
  text('history-state', '配对后读取本机历史记录。历史不是当前授权。');
  text('history-page', '');
  text('node-state', '配对后查询固定 RPC 源。');
  text('node-source', '');
  for (const name of ['status', 'latestBlock', 'validators']) {
    text('node-' + name + '-state', '未查询'); text('node-' + name + '-raw', '');
  }
  text('native-state', '尚未查询本机原生入口');
  text('native-peer', '未提供原生调用方凭据');
  text('native-note', '网页配对不证明浏览器的 OS 身份，也不授予节点管理或 Wallet 权限。');
  text('native-raw', '');
  text('anchor-summary', '独立上下文：尚未确认。RPC 查询不会自行取得独立验证标识。');
}
function clearPairing(message) {
  epoch++; paired = false; ticket = ''; abortAll(); clearTimeout(expiryTimer);
  sessionStorage.removeItem('ynxNetworkTicket'); sessionStorage.removeItem('ynxNetworkTicketExpires');
  invalidateEvidence(); clearPanels(); controls(); text('pair-state', message); notice(message);
}
async function api(path, body, op) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(op.ticket ? { Authorization: 'Bearer ' + op.ticket } : {}) },
    body: JSON.stringify(body || {}), cache: 'no-store', credentials: 'omit', signal: op.controller.signal
  });
  if (response.status === 401) {
    if (op.epoch === epoch && op.ticket === ticket) clearPairing('配对已过期、已撤销或 helper 已重启。请使用当前 helper 的一次性配对码重新连接。');
    throw new Error('PAIRING_REQUIRED');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'REQUEST_FAILED');
  return result;
}
function scheduleExpiry(expires) {
  clearTimeout(expiryTimer);
  const deadline = Date.parse(expires);
  if (!Number.isFinite(deadline)) return;
  const expiryEpoch = epoch, expiryTicket = ticket;
  expiryTimer = setTimeout(() => {
    if (epoch === expiryEpoch && ticket === expiryTicket) clearPairing('本次配对票据已到期。重启 helper 后可重新配对。');
  }, Math.max(0, Math.min(deadline - Date.now(), 15 * 60 * 1000)));
}
function readableTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString(typeof window!=='undefined'&&window.NetworkI18n?window.NetworkI18n.locale:'zh-Hans') : tr('时间未提供'); }
function collectionLabel(label, value) { return () => {
  if (!value || (value.status !== 'reported' && value.status !== 'unavailable')) return tr('{label}：未提供来源状态',{label:tr(label)});
  return tr('{label}：{state}{code}{source}',{label:tr(label),state:tr(value.status==='reported'?'已取回，仅表示来源返回':'不可用'),code:value.code?' · '+value.code:'',source:value.source?' · '+value.source:''});
}; }
function validateView(view, txId, historical = false) {
  if (!view || typeof view !== 'object' || txKey(view.txId) !== txKey(txId)) throw new Error('RECEIPT_TX_MISMATCH');
  const index = levels.indexOf(view.level);
  if (index < 0) throw new Error('UNKNOWN_PROOF_LEVEL');
  if (historical) return index;
  if (view.abciResultVerified === true && (index < 2 || !['succeeded','rejected','partial'].includes(view.executionOutcome)) || view.selectedMemberResultVerified === true && (view.abciResultVerified !== true || !['admitted','rejected'].includes(view.selectedMemberOutcome))) throw new Error('INVALID_PROOF_FLAGS');
  if (view.level === 'STATE_VERIFIED' && (view.fundsVerified !== true || view.stateScope === 'transaction-result-only')) throw new Error('STATE_NOT_PROVEN');
  return index;
}
function renderView(view, op, options = {}) {
  if (!current(op)) return false;
  const historical = options.historical === true;
  const index = validateView(view, options.txId || op.txId, historical);
  text('level-tag',historical?'历史记录 · {level}':'{level}',{level:view.level});
  $('level-tag').className = 'tag ' + (historical ? 'neutral' : index === 0 ? 'reported' : 'verified');
  document.querySelectorAll('.levels li').forEach((row, i) => {
    row.classList.toggle('reached', !historical && i > 0 && i <= index);
    row.classList.toggle('reported', !historical && i === 0);
    paint(row.querySelector('.step-status'), historical ? '未重新核验' : i === 0 ? '数据源报告' : i <= index ? '已验证' : i === 3 ? '等待状态证明' : '缺少证据');
  });
  $('evidence-meta').hidden = false;
  text('meta-tx', view.txId); text('meta-level',historical?'当时记录 {level}；当前未重新核验':'{level}',{level:view.level});
  text('meta-source', view.source || '独立证明来源未提供'); text('meta-height', view.height || '未证明');
  text('meta-reason',()=>[view.reason,reasonText(view)].filter(Boolean).join(' · '));
  const abci = view.abciResultVerified === true;
  text('execution-result',()=>tr(historical?'历史记录中：{result}':'{result}',{result:abci?tr(historical?'确定性 ABCI 结果当时记录为已核验 · {outcome}{code}':'确定性 ABCI 结果已核验 · {outcome}{code}',{outcome:tr(view.executionOutcome||'结果未说明'),code:view.abciExecutionCode?' · code '+view.abciExecutionCode:''}):tr('尚未验证确定性 ABCI 执行结果')}));
  text('member-result',()=>tr(historical?'历史记录中：{result}':'{result}',{result:view.selectedMemberResultVerified===true?tr(historical?'指定成员结果当时已核验 · {outcome}':'指定成员结果已核验 · {outcome}',{outcome:tr(view.selectedMemberOutcome||'未说明')}):tr('尚未验证指定成员的执行结果')}));
  text('funds-result', historical ? '历史记录不证明当前资金、账户或发票状态' : view.level === 'STATE_VERIFIED' && view.fundsVerified === true ? '本次具体资金状态已有对应证明；授权仍独立' : '资金、账户与发票状态尚未验证；ABCI 成功不等于到账证明');
  if (!historical) notice(reasonMessages[view.reason]||'已显示本次可证明层级。缺少的证明不会被推断为成功。');
  return true;
}
function renderReceipt(record, op, historical) {
  if (!current(op)) return false;
  const id = receiptID(record && record.receiptId), txId = canonicalTx(record.txId);
  if (op.receiptId && op.receiptId !== id || op.expectedTx && txKey(op.expectedTx) !== txKey(txId)) throw new Error('RECEIPT_ID_MISMATCH');
  if (!historical && txKey(txId) !== txKey(op.txId)) throw new Error('RECEIPT_TX_MISMATCH');
  validateView(record.view, txId, historical);
  if (historical) $('tx-id').value = txId;
  if (!renderView(record.view, op, { historical, txId })) return false;
  $('receipt-id').value = id;
  text('meta-receipt', id); text('meta-time',()=>readableTime(record.observedAt)); text('meta-context', record.contextPin || '未提供；历史标识不授予当前权限');
  text('collection-report', collectionLabel('裸交易报告', record.reportCollection));
  text('collection-proof', collectionLabel('证明来源', record.proofCollection));
  const exactReport = typeof record.reportText === 'string';
  const hasReport = exactReport || Object.prototype.hasOwnProperty.call(record, 'report');
  $('raw-panel').hidden = !hasReport;
  text('raw-report', exactReport ? record.reportText : hasReport ? JSON.stringify(record.report, null, 2) : '');
  text('raw-label', exactReport ? historical ? '查看保存时的原始 RPC 报告（历史快照）' : '查看本次原始 RPC 报告' : '查看已解析的 RPC 对象（原始字节未保存）');
  if (historical) notice('已查回原保存回执。历史层级、上下文标识和原始报告不代表当前授权、当前信任期或资金到账；可重新查询交易作本次核验。');
  publish('receipt',{record,historical});
  return true;
}
async function nodeReport() {
  if (!paired) return;
  publish('node',null);publish('networkState','loading'); const op = begin('node', { requiresPair: true }); text('node-state', '正在查询固定 RPC 源…'); text('node-source', '');
  for (const name of ['status', 'latestBlock', 'validators']) { text('node-' + name + '-state', '正在读取'); text('node-' + name + '-raw', ''); }
  try {
    const value = await api('/api/node-report', {}, op); if (!current(op)) return;
    if (value.classification !== 'RPC_ONLY' || !value.reports) throw new Error('INVALID_NODE_REPORT');
    let reported = 0;
    for (const name of ['status', 'latestBlock', 'validators']) {
      const report = value.reports[name];
      if (!report || (report.status !== 'reported' && report.status !== 'unavailable')) throw new Error('INVALID_NODE_REPORT');
      if (report.status === 'reported') reported++;
    }
    publish('node',value);publish('networkState',reported===3?'ready':'partial'); text('node-state','仅 RPC 返回 · {count}/3 项来源可读；不构成独立验证',{count:reported}); text('node-source', value.source || '来源未提供');
    for (const name of ['status', 'latestBlock', 'validators']) {
      const report = value.reports[name]; text('node-' + name + '-state', collectionLabel('来源', report));
      text('node-' + name + '-raw',report.status==='reported'?'已解析的来源对象（不等同于原始字节）：\n{report}':'本项不可用；不会填入估计数据。',{report:JSON.stringify(report.data,null,2)});
    }
  } catch (error) { if (current(op)) { publish('networkState','failed');text('node-state','节点报告未完成 · {error}',{error:error.message}); for (const name of ['status', 'latestBlock', 'validators']) text('node-' + name + '-state', '未取得本次报告'); } }
  finally { finish(op); controls(); }
}
async function nativeStatus() {
  if (!paired) return;
  publish('native',null); const op = begin('native', { requiresPair: true }); text('native-state', '正在读取本机 helper 的原生自检…'); text('native-peer', '本次凭据尚未提供'); text('native-raw', '');
  try {
    const value = await api('/api/native-status', {}, op); if (!current(op)) return;
    if (value.browserIdentityVerified !== false) throw new Error('BROWSER_IDENTITY_NOT_ESTABLISHED');
    const response = value.native, peer = response && response.peer;
    const verified = response && response.code === 'OK' && peer && peer.nativeIPCVerified === true && peer.browserIdentityVerified === false && Number.isInteger(peer.uid) && peer.uid >= 0 && peer.uid <= 4294967295;
    publish('native',value); text('native-state',verified?'helper 原生自连接已通过内核凭据核对':'原生自检不可用 · {code}',{code:value.code||response&&response.code||'NATIVE_UNAVAILABLE'});
    text('native-peer',()=>verified?tr('原生调用方 UID {uid} · PID {pid} · {source}',{uid:peer.uid,pid:Number.isInteger(peer.pid)&&peer.pid>0?peer.pid:tr('未提供'),source:peer.credentialSource||tr('来源未提供')}):tr('没有可显示的已核对原生凭据'));
    text('native-note','浏览器 OS 身份：未验证。以上只描述 helper 的原生自连接；不构成网页管理权限或 Wallet 批准。');
    text('native-raw', JSON.stringify(value, null, 2));
  } catch (error) { if (current(op)) { publish('native',{native:null,browserIdentityVerified:false,code:'NATIVE_UNAVAILABLE'}); text('native-state','原生状态未取得 · {error}',{error:error.message}); text('native-peer', '没有本次已核对原生凭据'); } }
  finally { finish(op); }
}
function renderHistoryPage() {
  const list = $('receipt-list'); list.replaceChildren();
  const filtered=receiptRows.filter(row=>historyFilter==='all'||historyFilter==='verified'&&row.reportedLevel!=='RPC_ONLY'||row.reportedLevel===historyFilter);
  for (const summary of filtered.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'history-row'; button.disabled = !paired;
    const tx = document.createElement('span'); tx.textContent = summary.txId;
    const details = document.createElement('span'); details.textContent = readableTime(summary.observedAt);
    const level=document.createElement('span');level.className='history-level';level.textContent=summary.reportedLevel;const source=document.createElement('span');source.className='history-source';source.textContent=typeof summary.source==='string'?summary.source:'—';const reason=document.createElement('span');reason.className='history-reason';reason.textContent=typeof summary.reason==='string'?summary.reason:'—';const action=document.createElement('span');action.className='history-action';action.textContent=tr('查回原记录');
    button.append(details, tx, level, source, reason, action); button.addEventListener('click', () => openHistorical(summary.receiptId, summary.txId)); list.appendChild(button);
  }
  text('history-page',filtered.length?'第 {page}/{pages} 页':'',{page:historyPage+1,pages:Math.ceil(filtered.length/PAGE_SIZE)}); controls();
  $('history-next').disabled=!paired||(historyPage+1)*PAGE_SIZE>=filtered.length;
}
async function refreshHistory() {
  if (!paired) return;
  const op = begin('history', { requiresPair: true }); text('history-state', '正在读取本机保存的回执标识…');
  try {
    const value = await api('/api/receipts', {}, op); if (!current(op)) return;
    if (value.classification !== 'historical-local-projection' || value.authority !== false || !Array.isArray(value.receipts) || value.receipts.length > 2048) throw new Error('INVALID_HISTORY_AUTHORITY');
    const rows = value.receipts.map(row => { receiptID(row.receiptId); canonicalTx(row.txId); if (!levels.includes(row.reportedLevel)) throw new Error('INVALID_HISTORY_LEVEL'); return row; });
    const unique = new Set(rows.map(row => row.receiptId)); if (unique.size !== rows.length) throw new Error('DUPLICATE_RECEIPT_ID');
    receiptRows = rows; historyPage = 0; renderHistoryPage();
    text('history-state',rows.length?'本机历史记录 {count} 条 · 不授予当前权限；选中后读取原保存快照':'本机尚无保存回执；完成一次真实查询后可在这里查回。',{count:rows.length});
  } catch (error) { if (current(op)) { receiptRows = []; historyPage = 0; renderHistoryPage(); text('history-state','历史读取未完成 · {error}',{error:error.message}); } }
  finally { finish(op); }
}
async function openHistorical(id, expectedTx) {
  if (!paired) return;
  invalidateEvidence('正在查回原保存回执…'); const op = begin('receipt', { requiresPair: true, receiptId: id, expectedTx });
  try {
    receiptID(id); const value = await api('/api/receipt', { id }, op); if (!current(op)) return;
    if (value.historical !== true || value.authority !== false) throw new Error('INVALID_HISTORY_AUTHORITY');
    renderReceipt(value.receipt, op, true);
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('历史回执未取得：{error}',true,{error:error.message}); } }
  finally { finish(op); }
}
async function status(refresh = true, announcePair = false) {
  const op = begin('status');
  try {
    const value = await api('/api/status', {}, op); if (!current(op)) return false;
    if (value.paired !== true || value.callerOsIdentityVerified !== false) throw new Error('INVALID_PAIRING_STATUS');
    paired = true; controls(); publish('status',value);
    const anchor = value.checkpoint;
    text('anchor-summary',value.pqIndependentTrustConfigured===true?'本机已配置独立 PQ 验证入口；每笔仍须实际取回证据并通过核验。':value.anchorConfigured&&anchor?'独立检查点 · {source} · 高度 {height} · 信任期至 {until}':'独立上下文：未配置。将读取原证明来源，缺独立 Source 时保持 RPC_ONLY。',{source:anchor?.source,height:anchor?.height,until:anchor?.trustUntil});
    text('pair-state','已配对本机 helper · 网页只读查证权限 · 浏览器 OS 身份未验证{version}',{version:value.version?' · '+value.version:''});
    const expiry = sessionStorage.getItem('ynxNetworkTicketExpires'); if (expiry) scheduleExpiry(expiry);
    if (announcePair) notice('配对完成。节点来源、原生自检和本机历史分别读取；查询交易将取回实际证明并显示本次层级。');
    if (refresh) await Promise.allSettled([nodeReport(), nativeStatus(), refreshHistory()]);
    return current(op) && paired;
  } catch (error) {
    if (current(op)) { paired = false; controls(); invalidateEvidence(); clearPanels(); text('pair-state', 'helper 连接尚未确认，请重开当前入口或使用新的配对码。'); notice('连接未确认：{error}',true,{error:error.message}); }
    return false;
  } finally { finish(op); }
}
$('tx-id').addEventListener('input', () => invalidateEvidence('交易已更改，请重新查询或导入对应证明。'));
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault(); epoch++; paired = false; ticket = ''; abortAll(); clearTimeout(expiryTimer); invalidateEvidence(); clearPanels(); controls();
  sessionStorage.removeItem('ynxNetworkTicket'); sessionStorage.removeItem('ynxNetworkTicketExpires');
  const op = begin('pair'); $('pair-button').disabled = true; notice('正在配对本机 helper…');
  try {
    const challenge = await api('/api/pair/challenge', {}, op); if (!current(op)) return;
    const result = await api('/api/pair', { challenge: challenge.challenge, code: $('pair-code').value.trim() }, op); if (!current(op)) return;
    if (typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 512) throw new Error('INVALID_PAIRING_TICKET');
    $('pair-code').value = ''; ticket = result.ticket; sessionStorage.setItem('ynxNetworkTicket', ticket);
    if (typeof result.expires === 'string') sessionStorage.setItem('ynxNetworkTicketExpires', result.expires);
    finish(op); await status(true, true);
  } catch (error) { if (current(op)) notice('配对未完成：{error}',true,{error:error.message}); }
  finally { finish(op); $('pair-button').disabled = false; }
});
$('revoke').addEventListener('click', async () => {
  if (!paired) return;
  epoch++; paired = false; abortAll(); clearTimeout(expiryTimer); invalidateEvidence(); clearPanels(); controls();
  const op = begin('revoke'); notice('正在撤销本次网页查证权限…');
  try {
    const value = await api('/api/revoke', {}, op); if (!current(op)) return;
    if (value.revoked !== true) throw new Error('REVOCATION_NOT_CONFIRMED');
    clearPairing('配对已撤销；原票据失效。重启 helper 后可重新配对。');
  } catch (error) { if (current(op)) clearPairing(()=>tr('本页票据已清除；helper 撤销结果未确认，请关闭该 helper。{error}',{error:error.message})); }
  finally { finish(op); }
});
$('lookup-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!paired) return;
  invalidateEvidence('正在读取裸交易报告与原证明来源，尚无本次结论。'); const op = begin('receipt', { requiresPair: true });
  try {
    op.txId = canonicalTx($('tx-id').value); $('lookup-button').disabled = true;
    const record = await api('/api/client-receipt', { txId: op.txId }, op); if (!current(op)) return;
    if (renderReceipt(record, op, false)) await refreshHistory();
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('本次回执未完成：{error}',true,{error:error.message}); } }
  finally { finish(op); controls(); }
});
$('proof-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || !paired) return;
  invalidateEvidence('正在使用本机真实验证入口核对导入证明…'); const op = begin('receipt', { requiresPair: true }); text('proof-file-name', file.name);
  try {
    op.txId = canonicalTx($('tx-id').value); if (file.size > 3 * 1024 * 1024) throw new Error('证明文件超过 3 MiB');
    const proof = JSON.parse(await file.text()); if (!current(op)) return;
    const view = await api('/api/verify', { txId: op.txId, proof }, op);
    if (renderView(view, op)) { text('collection-report', '导入证明：未查询裸 RPC 报告'); text('collection-proof', '导入内容只作待核对证明；不导入独立信任或权限'); }
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('导入证明未通过：{error}',true,{error:error.message}); } }
  finally { finish(op); event.target.value = ''; }
});
$('node-refresh').addEventListener('click', nodeReport);
for(const id of ['native-refresh','participation-refresh','resource-refresh'])$(id).addEventListener('click', nativeStatus);
$('history-refresh').addEventListener('click', refreshHistory);
$('history-form').addEventListener('submit', event => { event.preventDefault(); return openHistorical($('receipt-id').value.trim()); });
$('history-prev').addEventListener('click', () => { if (paired && historyPage > 0) { historyPage--; renderHistoryPage(); } });
$('history-next').addEventListener('click', () => { if (paired && (historyPage + 1) * PAGE_SIZE < receiptRows.filter(row=>historyFilter==='all'||historyFilter==='verified'&&row.reportedLevel!=='RPC_ONLY'||row.reportedLevel===historyFilter).length) { historyPage++; renderHistoryPage(); } });
if(typeof window!=='undefined')window.NetworkClient=Object.freeze({setHistoryFilter(value){if(!['all','RPC_ONLY','verified'].includes(value))return;historyFilter=value;historyPage=0;renderHistoryPage();},rerenderLocale(){for(const [el,render]of textBindings)el.textContent=render();renderHistoryPage();}});
invalidateEvidence();
controls();
if (typeof window !== 'undefined') window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  epoch++; paired=false;abortAll();clearTimeout(expiryTimer);invalidateEvidence('页面已恢复，正在重新确认 helper 与当前票据。');clearPanels();controls();
  if (ticket) status();
});
if (ticket) status();
// Foreground, paired, bounded refresh only. Never overlaps an original read,
// re-pairs, retries an effect or turns a cached report into fresh data.
if(typeof window!=='undefined'&&typeof window.setInterval==='function') {
  const refresh=()=>{publish('networkClock',null);if(paired&&!pending.has('node')&&document.visibilityState!=='hidden')nodeReport();};
  window.setInterval(refresh,15000);
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// The fixed native bridge authenticates its native transport, not the browser or
// a Wallet approval. Capability observations permit an attempt only. Exact
// intents, IDs and original review data always come back from the native callee.
(() => {
  let generation=0, busy=null, node=null, nodeCaps={}, nodeIntent=null, partCaps={}, resourceCaps={}, resource=null, review=null, entry=null, cursor='', formVersion=0;
  const entries=new Map(), attempted=new Set(), uncertain=new Set(), unresolved=new Map(), knownRequests=new Set();
  let preparingRequest=null, recoveredDifference=false, partCode=null;
  const nodeKeys=['install','start','stop','restart','visibleConsent','read','logs'];
  const partKeys=['prepare','read','review','cancel','reconcile','submit','revoke','list'];
  const resourceKeys=['read','meter','stop','review','cancelReview','productionDispatch'];
  const bridge=()=>window.NetworkNative;
  const ready=()=>bridge()?.available===true&&bridge()?.ready===true;
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const ref=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
  const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
  const exactID=v=>typeof v==='string'&&/^[a-f0-9]{24}$/.test(v);
  function caps(value,keys){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>typeof value[k]!=='boolean'))return {};return {...value};}
  const raw=(id,value)=>text(id,value===undefined||value===null?'—':String(value));
  const original=(id,value)=>raw(id,value?JSON.stringify(value,null,2):null);
  function state(id,code){text(id,()=>tr('本机返回：{code}',{code})+(code==='UNKNOWN'?' · '+tr('原结果未确定。先读取原状态，不要重复操作。'):code==='CANCELLED'?' · '+tr('本机操作已取消。'):''));}
  function disabled(id,enabled){$(id).disabled=!ready()||!!busy||!enabled;}
  function authority(value,field){if(!object(value)||value[field]!==false||typeof value.code!=='string'||!/^([A-Z][A-Z_]{0,63})$/.test(value.code))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID',outcome:'UNKNOWN'});}
  async function request(operation,payload={}){
    const response=await bridge().request(operation,payload);
    if(response?.version!=='YNX-NETWORK-LOCAL-IPC/v1'||response.code!=='OK'||response.peer?.nativeIPCVerified!==true||response.peer?.browserIdentityVerified!==false||!Number.isSafeInteger(response.peer?.uid)||response.peer.uid<0||response.peer.uid>4294967295||!object(response.result))throw Object.assign(new Error(response?.code||'NATIVE_RESPONSE_INVALID'),{code:response?.code||'NATIVE_RESPONSE_INVALID',outcome:'UNKNOWN'});
    return response.result;
  }
  async function run(channel,task,effect=false){
    if(!ready()){state('native-'+channel+'-operation','NATIVE_REQUIRED');render();return;}
    if(busy){state('native-'+channel+'-operation','NATIVE_BUSY');return;}
    const op={generation,channel,effect};busy=op;text('native-'+channel+'-operation',effect?(channel==='node'?'等待原生确认；网页不能批准。':channel==='part'?'交由 Wallet 审阅':'正在释放本机资源'):'正在读取');render();
    try{await task(()=>generation===op.generation&&busy===op&&ready());}
    catch(error){if(op.generation===generation){if(channel==='node'){nodeCaps={};nodeIntent=null;}if(channel==='part'){partCaps={};review=null;}if(channel==='resource')resourceCaps={};const code=error?.outcome==='UNKNOWN'||effect&&error?.outcome!=='NOT_SENT'?'UNKNOWN':error?.code||'NATIVE_UNAVAILABLE';if(channel==='part'&&effect&&code==='UNKNOWN'&&entry)uncertain.add(entry.id);state('native-'+channel+'-operation',code);if(effect&&code==='UNKNOWN'){nodeIntent=null;if(channel==='node')nodeCaps={};if(channel==='resource')resourceCaps={};review=null;}}}
    finally{if(busy===op)busy=null;render();}
  }
  function nodeStatus(value){authority(value,'productionGrant');nodeCaps=caps(value.capabilities,nodeKeys);if(value.code!=='OK'||!object(value.node)){node=null;return value.code;}const n=value.node;if(n.nodeId!=='ordinary-node'||typeof n.productionSupported!=='boolean'||typeof n.processOwned!=='boolean'||!uint(n.generation)||!['production','isolated-lifecycle-fixture'].includes(n.mode)||!ref(n.stage)||typeof n.artifactSHA256!=='string')throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});node=n;return value.code;}
  function acceptEntry(value,select=true){if(!object(value)||!exactID(value.id)||!object(value.intent)||!object(value.intent.request)||!['delegate','unbond','withdraw','vote'].includes(value.intent.request.action)||!ref(value.state))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});entries.set(value.id,{id:value.id,requestId:value.intent.request.requestId,action:value.intent.request.action,state:value.state,createdAt:value.createdAt,updatedAt:value.updatedAt});if(select){entry=value;review=null;recoveredDifference=false;$('native-part-id').value=value.id;}return value;}
  function participation(value){authority(value,'walletApproval');partCode=value.code;partCaps=caps(value.capabilities,partKeys);if(value.authority!==undefined&&value.authority!==false)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});return value.code;}
  function resourceStatus(value){authority(value,'productionEnabled');resourceCaps=caps(value.capabilities,resourceKeys);if(resourceCaps.productionDispatch===true)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});resource=value;raw('native-resource-preview-bytes',null);raw('native-resource-preview-sha',null);original('native-resource-original',value);raw('native-resource-code',value.code);return value.code;}
  async function list(current,next=false){entry=null;review=null;recoveredDifference=false;const result=(await request('participation_list',next?{cursor,limit:20}:{limit:20})).payload;if(!current())return;participation(result);if(!Array.isArray(result.entries)||result.entries.length>50||result.authority!==false||result.nextCursor!==undefined&&(typeof result.nextCursor!=='string'||result.nextCursor.length>512))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});if(!next)entries.clear();const seenIDs=new Set();for(const row of result.entries){if(seenIDs.has(row?.id))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});seenIDs.add(row?.id);if(!object(row)||!exactID(row.id)||!ref(row.requestId)||!['delegate','unbond','withdraw','vote'].includes(row.action)||!ref(row.state))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});entries.set(row.id,row);}cursor=result.nextCursor||'';state('native-part-operation',result.code);}
  async function load(channel='node'){
    return run(channel,async current=>{
      nodeIntent=null;review=null;node=null;resource=null;nodeCaps={};partCaps={};resourceCaps={};
      const read=async(kind,fn)=>{try{await fn();}catch(error){if(!current())return;if(kind==='node'){nodeCaps={};node=null;}if(kind==='part')partCaps={};if(kind==='resource'){resourceCaps={};resource=null;}state('native-'+kind+'-operation',error?.code||'NATIVE_UNAVAILABLE');}};
      await read('node',async()=>{const n=(await request('node_status',{})).payload;if(current())state('native-node-operation',nodeStatus(n));});if(!current())return;
      await read('resource',async()=>{const res=(await request('resource_status',{})).payload;if(current())state('native-resource-operation',resourceStatus(res));});if(!current())return;
      await read('part',()=>list(current,false));
    });
  }
  function render(){
    const connected=ready(), note=connected?'能力只表示可尝试，仍须原生确认或 Wallet 批准。':'请在 Network 原生 App 中操作。浏览器不具备本机操作入口。';
    for(const channel of ['node','part','resource']){text('native-'+channel+'-notice',channel==='node'&&connected&&node?.mode==='production'&&node.productionSupported!==true?'正式节点安装仍须原发布方工件与独立可见批准。':channel==='part'&&connected&&partCode&&partCode!=='OK'?()=>tr('本机返回：{code}',{code:partCode})+' · '+tr(partCode==='NOT_SUPPLIED'?'当前接口未提供':partCode==='UNAVAILABLE'?'不可用':partCode==='UNKNOWN'?'原结果未确定。先读取原状态，不要重复操作。':'能力只表示可尝试，仍须原生确认或 Wallet 批准。'):note);disabled('native-'+channel+'-read',true);}
    raw('native-node-stage',node?.stage);raw('native-node-mode',node?.mode);raw('native-node-run',node?.runId||null);
    if(node){
      raw('managed-node-state',node.stage);raw('local-node-code',node.productionSupported?'OK':'UNSUPPORTED');raw('local-node-bytes',node.capacity?.complete===true&&uint(node.capacity.usedBytes)?node.capacity.usedBytes+' B':null);
      const diagnostic=object(node.diagnostics)&&node.diagnostics.authority===false?node.diagnostics:null;
      const logs=diagnostic?.logs;raw('local-node-logs-state',logs?.code);for(const stream of ['stdout','stderr']){const value=logs?.[stream]?.text;raw('local-node-'+stream,typeof value==='string'&&value.length<=16384?value:null);}
      text('local-node-sync','当前接口未提供');text('local-node-recovery',diagnostic?.recovery?.priorEffectUnknown===true?'结果未确定。':node.processOwned?'本软件持有当前运行进程':'无运行任务');
    }
    if(resource?.meter){const meter=resource.meter;const count=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):uint(value)?value:null;
      text('resource-state',meter.state==='disabled'||meter.state==='stopped'?'已关闭':meter.class==='CONTROLLED_SANDBOX'&&meter.state==='running'?'本机隔离测试中。':'不可用');raw('resource-code',resource.code);raw('resource-verified-jobs',count(meter.verifiedJobs));raw('resource-verified-bytes',count(meter.verifiedBytes)===null?null:count(meter.verifiedBytes)+' B');raw('resource-active-workers',count(meter.activeWorkers));
    }
    const mode=node?.mode==='production'&&node.productionSupported===true;
    disabled('native-node-install',nodeCaps.install===true&&nodeCaps.visibleConsent===true&&mode&&node?.stage==='not_installed');
    disabled('native-node-start',nodeCaps.start===true&&nodeCaps.visibleConsent===true&&mode&&['installed','stopped','exited'].includes(node?.stage)&&node?.processOwned===false);
    disabled('native-node-stop',nodeCaps.stop===true&&nodeCaps.visibleConsent===true&&node?.processOwned===true&&node?.stage==='running');
    disabled('native-node-restart',nodeCaps.restart===true&&nodeCaps.visibleConsent===true&&mode&&node?.processOwned===true&&node?.stage==='running');
    $('native-node-intent-panel').hidden=!nodeIntent;original('native-node-intent',nodeIntent);disabled('native-node-confirm',!!nodeIntent&&nodeCaps[nodeIntent.action]===true&&nodeCaps.visibleConsent===true);disabled('native-node-cancel',!!nodeIntent);
    const action=$('native-part-action').value||'delegate';$('native-part-amount-field').hidden=action==='withdraw'||action==='vote';$('native-part-amount').required=action!=='withdraw'&&action!=='vote';$('native-part-choice-field').hidden=action!=='vote';
    text('native-part-target-note',action==='delegate'?'填写原验证者标识。':action==='unbond'?'填写原委托标识。':action==='withdraw'?'填写原解押标识。':'填写原提案标识；不会在网页生成投票编码。');
    disabled('native-part-prepare',partCaps.prepare===true&&unresolved.size===0&&!knownRequests.has($('native-part-request').value.trim()));$('native-part-draft').disabled=!!busy||unresolved.size>0||entry?.state==='UNKNOWN'||entry?.state==='AWAITING_WALLET';disabled('native-part-resolve',partCaps.read===true&&(unresolved.size>0||ref($('native-part-request').value.trim())));disabled('native-part-list',partCaps.list===true);disabled('native-part-next',partCaps.list===true&&!!cursor);disabled('native-part-get',partCaps.read===true);disabled('native-part-revoke',partCaps.revoke===true);
    $('native-part-entry-panel').hidden=!entry;raw('native-part-entry-id',entry?.id);raw('native-part-entry-state',entry&&uncertain.has(entry.id)?'UNKNOWN':entry?.state);raw('native-part-blocked',entry?.blockedReason||entry?.lastError||null);
    const reviewed=unresolved.size===0&&review&&review.entry?.id===entry?.id&&review.authority===false&&review.requiresWalletApproval===true&&review.walletAdapterConfigured===true&&review.originalEffectMayExist===false&&review.conditionStatus==='CURRENT_RPC_REPORTED';
    disabled('native-part-review',partCaps.review===true&&!!entry);disabled('native-part-cancel',partCaps.cancel===true&&!!entry);disabled('native-part-reconcile',partCaps.reconcile===true&&!!entry);disabled('native-part-submit',partCaps.submit===true&&entry?.state==='PREPARED'&&reviewed&&!entry.publishAttemptedAt&&!attempted.has(entry.id));
    const req=entry?.intent?.request;for(const [key,value]of Object.entries({action:req?.action,owner:req?.owner,target:req?.validator||req?.delegationId||req?.unbondingId||req?.proposal,amount:req?.amountYnxt,fee:req?.feeCapYnxt,expires:req?.expiresAt}))raw('native-part-original-'+key,value);
    $('native-part-recovery').hidden=unresolved.size===0&&!recoveredDifference;text('native-part-recovery',()=>unresolved.size?tr('原结果未确定。先读取原状态，不要重复操作。')+' '+[...unresolved.keys()].join(' · '):recoveredDifference?tr('查回的原请求内容与草稿不同；不会按草稿修改原请求。'):'');
    original('native-part-original',review||entry);
    const history=$('native-part-records');history.replaceChildren();for(const row of entries.values()){const button=document.createElement('button');button.type='button';button.className='native-entry-row';button.disabled=!connected||!!busy||partCaps.read!==true;button.textContent=[row.action,row.state,row.requestId,row.id,row.updatedAt||row.createdAt||'—'].join(' · ');button.addEventListener('click',()=>get(row.id));history.append(button);}
    disabled('native-resource-meter',resourceCaps.meter===true);disabled('native-resource-stop',resourceCaps.stop===true);disabled('native-resource-review',resourceCaps.review===true);disabled('native-resource-cancel',resourceCaps.cancelReview===true);
  }
  function reset(){partCode=null;recoveredDifference=false;if(preparingRequest)unresolved.set(preparingRequest.requestId,{request:preparingRequest});if(busy?.effect&&busy.channel==='part'&&entry)uncertain.add(entry.id);generation++;busy=null;node=null;nodeCaps={};nodeIntent=null;partCaps={};resourceCaps={};resource=null;review=null;entry=null;cursor='';entries.clear();for(const id of ['native-node-operation','native-part-operation','native-resource-operation'])text(id,'');for(const id of ['native-resource-original','native-resource-code','native-resource-preview-bytes','native-resource-preview-sha'])raw(id,null);render();}
  for(const id of ['native-node-read','native-part-read','native-resource-read'])$(id).addEventListener('click',()=>load(id.includes('resource')?'resource':id.includes('part')?'part':'node'));
  for(const action of ['install','start','stop'])$('native-node-'+action).addEventListener('click',()=>{if($('native-node-'+action).disabled)return;return run('node',async current=>{if(nodeCaps[action]!==true||nodeCaps.visibleConsent!==true)throw Object.assign(new Error('UNSUPPORTED'),{code:'UNSUPPORTED',outcome:'NOT_SENT'});const hash=action==='install'?$('native-node-artifact').value.trim():'';if(action==='install'&&!/^[a-f0-9]{64}$/.test(hash))throw Object.assign(new Error('INVALID_ARTIFACT_SHA256'),{code:'INVALID_ARTIFACT_SHA256',outcome:'NOT_SENT'});const value=(await request('node_prepare',{action,artifactSHA256:hash})).payload;if(!current())return;authority(value,'productionGrant');const intent=value.node;if(value.code==='PREPARED'&&object(intent)&&Object.keys(intent).length===5&&ref(intent.managerId)&&intent.nodeId==='ordinary-node'&&intent.action===action&&intent.generation===node?.generation&&intent.artifactSHA256===(hash||node?.artifactSHA256)){nodeIntent=intent;}else{nodeIntent=null;if(value.code==='PREPARED')throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});}state('native-node-operation',value.code);});});
  $('native-node-cancel').addEventListener('click',()=>{nodeIntent=null;state('native-node-operation','CANCELLED');render();});
  $('native-node-confirm').addEventListener('click',()=>{const intent=nodeIntent;if(!intent||nodeCaps[intent.action]!==true||nodeCaps.visibleConsent!==true)return;nodeIntent=null;run('node',async current=>{const value=(await request('node_'+intent.action,intent)).payload;if(!current())return;authority(value,'productionGrant');state('native-node-operation',value.code);nodeCaps={};},true);});
  $('native-node-restart').addEventListener('click',()=>{if(nodeCaps.restart!==true||nodeCaps.visibleConsent!==true||node?.processOwned!==true)return;run('node',async current=>{const value=(await request('node_restart',{})).payload;if(!current())return;authority(value,'productionGrant');nodeIntent=null;nodeCaps={};state('native-node-operation',value.code);},true);});
  function draftChanged(){formVersion++;review=null;entry=null;recoveredDifference=false;render();}
  for(const name of ['action','request','owner','target','amount','fee','expires','choice'])$('native-part-'+name).addEventListener(name==='action'||name==='choice'?'change':'input',draftChanged);
  $('native-part-draft').addEventListener('click',()=>{if(busy||unresolved.size)return;const bytes=new Uint8Array(16);if(!window.crypto?.getRandomValues){state('native-part-operation','LOCAL_ID_UNAVAILABLE');return;}window.crypto.getRandomValues(bytes);$('native-part-request').value='local-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');$('native-part-expires').value=new Date(Date.now()+5*60*1000).toISOString();draftChanged();});
  function requestForm(){const action=$('native-part-action').value||'delegate',req={requestId:$('native-part-request').value.trim(),owner:$('native-part-owner').value.trim(),action,feeCapYnxt:$('native-part-fee').value.trim(),expiresAt:$('native-part-expires').value.trim()},target=$('native-part-target').value.trim(),amount=$('native-part-amount').value.trim(),expiry=Date.parse(req.expiresAt);if(!ref(req.requestId)||!/^0x[a-f0-9]{40}$/.test(req.owner)||!uint(req.feeCapYnxt)||!Number.isFinite(expiry)||!req.expiresAt.endsWith('Z')||expiry<=Date.now()||expiry>Date.now()+10*60*1000)throw Object.assign(new Error('INVALID_REQUEST'),{code:'INVALID_REQUEST',outcome:'NOT_SENT'});if(action==='delegate'||action==='unbond'){if(!uint(amount)||BigInt(amount)===0n||BigInt(amount)>9223372036854775807n)throw Object.assign(new Error('INVALID_AMOUNT'),{code:'INVALID_AMOUNT',outcome:'NOT_SENT'});req.amountYnxt=amount;if(action==='delegate'&&ref(target))req.validator=target;else if(action==='unbond'&&exactID(target))req.delegationId=target;else throw Object.assign(new Error('INVALID_TARGET'),{code:'INVALID_TARGET',outcome:'NOT_SENT'});}else if(action==='withdraw'&&exactID(target))req.unbondingId=target;else if(action==='vote'&&ref(target)&&['yes','no','abstain'].includes($('native-part-choice').value)){req.proposal=target;req.choice=$('native-part-choice').value;}else throw Object.assign(new Error('INVALID_TARGET'),{code:'INVALID_TARGET',outcome:'NOT_SENT'});return req;}
  $('native-part-form').addEventListener('submit',event=>{event.preventDefault();if(partCaps.prepare!==true||$('native-part-prepare').disabled)return;const form=formVersion;run('part',async current=>{const req=requestForm();preparingRequest=req;try{const value=(await request('participation_prepare',req)).payload;if(!current())return;participation(value);if(value.entry){acceptEntry(value.entry,form===formVersion);knownRequests.add(req.requestId);}state('native-part-operation',value.code);}catch(error){if(error?.outcome==='NOT_SENT')unresolved.delete(req.requestId);else{unresolved.set(req.requestId,{request:req,cause:error?.code||'NATIVE_RESPONSE_INVALID'});throw Object.assign(new Error(error?.message||'NATIVE_RESPONSE_INVALID'),{code:error?.code||'NATIVE_RESPONSE_INVALID',outcome:'UNKNOWN'});}throw error;}finally{if(preparingRequest===req)preparingRequest=null;}});});
  async function get(id){if(!exactID(id)||partCaps.read!==true)return;return run('part',async current=>{entry=null;review=null;recoveredDifference=false;const value=(await request('participation_get',{id})).payload;if(!current())return;participation(value);if(value.entry&&value.entry.id===id)acceptEntry(value.entry);else if(value.entry)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});state('native-part-operation',value.code);});}
  $('native-part-get-form').addEventListener('submit',event=>{event.preventDefault();get($('native-part-id').value.trim());});
  function requestShape(value){const keys=['requestId','owner','action','proposal','choice','validator','delegationId','unbondingId','amountYnxt','feeCapYnxt','expiresAt'];return object(value)&&Object.keys(value).every(k=>keys.includes(k))?JSON.stringify(keys.map(k=>value[k]??'')):null;}
  $('native-part-resolve').addEventListener('click',()=>{const id=unresolved.keys().next().value||$('native-part-request').value.trim();if(!ref(id)||partCaps.read!==true)return;run('part',async current=>{const pending=unresolved.get(id),value=(await request('participation_resolve',{requestId:id})).payload;if(!current())return;participation(value);if(value.authority!==false||value.resolvedRequestId!==id)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});knownRequests.add(id);if(value.code==='OK'&&value.entry){acceptEntry(value.entry);recoveredDifference=!!pending&&requestShape(value.entry.intent.request)!==requestShape(pending.request);unresolved.delete(id);}else{entry=null;review=null;}state('native-part-operation',unresolved.has(id)?'UNKNOWN':value.code);});});
  $('native-part-list').addEventListener('click',()=>run('part',current=>list(current,false)));
  $('native-part-next').addEventListener('click',()=>{if(cursor&&partCaps.list===true)run('part',current=>list(current,true));});
  for(const action of ['review','cancel','reconcile','submit'])$('native-part-'+action).addEventListener('click',()=>{const id=entry?.id;if(!id||partCaps[action]!==true||action==='submit'&&$('native-part-submit').disabled)return;if(busy)return;if(action==='submit')attempted.add(id);const selected=id;run('part',async current=>{let value;try{value=(await request('participation_'+action,{id})).payload;}catch(error){if(action==='submit'&&error?.outcome==='NOT_SENT')attempted.delete(id);throw error;}if(!current())return;participation(value);if(value.entry){if(value.entry.id!==id)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});acceptEntry(value.entry);}if(action==='review'&&value.review){const candidate=value.review;if(candidate.entry?.id!==id||JSON.stringify(candidate.entry?.intent)!==JSON.stringify(entry?.intent)||candidate.version!=='YNX-NETWORK-PARTICIPATION-REVIEW/v1'||candidate.authority!==false||candidate.requiresWalletApproval!==true||candidate.independentFinality!==false)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});review=candidate;acceptEntry(candidate.entry);review=candidate;}if(entry?.id!==selected)review=null;state('native-part-operation',value.code);},action==='submit');});
  $('native-part-revoke').addEventListener('click',()=>{if(partCaps.revoke!==true)return;run('part',async current=>{const value=(await request('participation_revoke',{})).payload;if(!current())return;participation(value);review=null;nodeIntent=null;state('native-part-operation',value.code);},true);});
  document.querySelectorAll('[data-participation-action]').forEach(button=>button.addEventListener('click',()=>{$('native-part-action').value=button.dataset.participationAction;if(button.dataset.participationChoice)$('native-part-choice').value=button.dataset.participationChoice;draftChanged();$('native-part-form').scrollIntoView?.({block:'start'});}));
  for(const action of ['meter','stop','review','cancel'])$('native-resource-'+action).addEventListener('click',()=>{const key=action==='cancel'?'cancelReview':action;if(resourceCaps[key]!==true)return;run('resource',async current=>{raw('native-resource-preview-bytes',null);raw('native-resource-preview-sha',null);const value=(await request(action==='cancel'?'resource_review_cancel':'resource_'+action,{})).payload;if(!current())return;if(action==='review'||action==='cancel'){authority(value,'authority');if(value.productionEnabled!==false||value.consentProduced!==false)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});raw('native-resource-code',value.code);raw('native-resource-preview-bytes',uint(value.previewBytes)?value.previewBytes:null);raw('native-resource-preview-sha',typeof value.previewSHA256==='string'&&/^[a-f0-9]{64}$/.test(value.previewSHA256)?value.previewSHA256:null);original('native-resource-original',value);resourceCaps=caps(value.capabilities,resourceKeys);}else resourceStatus(value);state('native-resource-operation',value.code);},action==='stop');});
  window.addEventListener('network:native-state',()=>{reset();if(ready())load('node');});
  window.addEventListener('pagehide',reset);
  window.NetworkOperations=Object.freeze({reset,refresh:load,rerenderLocale:render});
  window.NetworkI18n?.subscribe(render);
  if(!$('native-part-action').value)$('native-part-action').value='delegate';
  render();if(ready())load('node');
})();
