'use strict';
const $ = id => document.getElementById(id);
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
function text(id, value) { $(id).textContent = value; }
function notice(value, error = false) { text('notice', value); $('notice').classList.toggle('error', error); }
function controls() {
  for (const id of ['proof-file']) $(id).disabled = !paired;
  for (const [id,channel] of [['lookup-button','receipt'],['history-open','receipt'],['node-refresh','node'],['native-refresh','native'],['history-refresh','history']]) $(id).disabled = !paired || pending.has(channel);
  $('pair-form').hidden = paired;
  $('revoke').hidden = !paired;
  $('history-prev').disabled = !paired || historyPage === 0;
  $('history-next').disabled = !paired || (historyPage + 1) * PAGE_SIZE >= receiptRows.length;
}
function abort(channel) { const op = pending.get(channel); if (op) op.controller.abort(); pending.delete(channel); }
function abortAll() { for (const op of pending.values()) op.controller.abort(); pending.clear(); }
function begin(channel, options = {}) {
  abort(channel);
  const op = { channel, epoch, ticket, controller: new AbortController(), ...options };
  pending.set(channel, op);
  return op;
}
function current(op) {
  return pending.get(op.channel) === op && !op.controller.signal.aborted && op.epoch === epoch && op.ticket === ticket &&
    (!op.requiresPair || paired) && (!op.txId || txKey($('tx-id').value) === txKey(op.txId));
}
function finish(op) { if (pending.get(op.channel) === op) pending.delete(op.channel); }
function invalidateEvidence(message) {
  abort('receipt');
  text('level-tag', '尚未查询'); $('level-tag').className = 'tag neutral';
  document.querySelectorAll('.levels li').forEach((row, index) => {
    row.classList.remove('reached', 'reported');
    row.querySelector('.step-status').textContent = index === 0 ? '待查询' : index === 3 ? '等待状态证明' : '缺少证据';
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
function readableTime(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '时间未提供'; }
function collectionLabel(label, value) {
  if (!value || (value.status !== 'reported' && value.status !== 'unavailable')) return label + '：未提供来源状态';
  return label + '：' + (value.status === 'reported' ? '已取回，仅表示来源返回' : '不可用') + (value.code ? ' · ' + value.code : '') + (value.source ? ' · ' + value.source : '');
}
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
  text('level-tag', historical ? '历史记录 · ' + view.level : view.level);
  $('level-tag').className = 'tag ' + (historical ? 'neutral' : index === 0 ? 'reported' : 'verified');
  document.querySelectorAll('.levels li').forEach((row, i) => {
    row.classList.toggle('reached', !historical && i > 0 && i <= index);
    row.classList.toggle('reported', !historical && i === 0);
    row.querySelector('.step-status').textContent = historical ? '未重新核验' : i === 0 ? '数据源报告' : i <= index ? '已验证' : i === 3 ? '等待状态证明' : '缺少证据';
  });
  $('evidence-meta').hidden = false;
  text('meta-tx', view.txId); text('meta-level', historical ? '当时记录 ' + view.level + '；当前未重新核验' : view.level);
  text('meta-source', view.source || '独立证明来源未提供'); text('meta-height', view.height || '未证明');
  text('meta-reason', [view.reason, view.detail].filter(Boolean).join(' · ') || '未提供');
  const prefix = historical ? '历史记录中：' : '';
  const abci = view.abciResultVerified === true;
  text('execution-result', prefix + (abci ? '确定性 ABCI 结果' + (historical ? '当时记录为已核验' : '已核验') + ' · ' + (view.executionOutcome || '结果未说明') + (view.abciExecutionCode ? ' · code ' + view.abciExecutionCode : '') : '尚未验证确定性 ABCI 执行结果'));
  text('member-result', prefix + (view.selectedMemberResultVerified === true ? '指定成员结果' + (historical ? '当时已核验' : '已核验') + ' · ' + (view.selectedMemberOutcome || '未说明') : '尚未验证指定成员的执行结果'));
  text('funds-result', historical ? '历史记录不证明当前资金、账户或发票状态' : view.level === 'STATE_VERIFIED' && view.fundsVerified === true ? '本次具体资金状态已有对应证明；授权仍独立' : '资金、账户与发票状态尚未验证；ABCI 成功不等于到账证明');
  if (!historical) notice(view.detail || '已显示本次可证明层级。缺少的证明不会被推断为成功。');
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
  text('meta-receipt', id); text('meta-time', readableTime(record.observedAt)); text('meta-context', record.contextPin || '未提供；历史标识不授予当前权限');
  text('collection-report', collectionLabel('裸交易报告', record.reportCollection));
  text('collection-proof', collectionLabel('证明来源', record.proofCollection));
  const exactReport = typeof record.reportText === 'string';
  const hasReport = exactReport || Object.prototype.hasOwnProperty.call(record, 'report');
  $('raw-panel').hidden = !hasReport;
  text('raw-report', exactReport ? record.reportText : hasReport ? JSON.stringify(record.report, null, 2) : '');
  text('raw-label', exactReport ? historical ? '查看保存时的原始 RPC 报告（历史快照）' : '查看本次原始 RPC 报告' : '查看已解析的 RPC 对象（原始字节未保存）');
  if (historical) notice('已查回原保存回执。历史层级、上下文标识和原始报告不代表当前授权、当前信任期或资金到账；可重新查询交易作本次核验。');
  return true;
}
async function nodeReport() {
  if (!paired) return;
  const op = begin('node', { requiresPair: true }); text('node-state', '正在查询固定 RPC 源…'); text('node-source', '');
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
    text('node-state', '仅 RPC 返回 · ' + reported + '/3 项来源可读；不构成独立验证'); text('node-source', value.source || '来源未提供');
    for (const name of ['status', 'latestBlock', 'validators']) {
      const report = value.reports[name]; text('node-' + name + '-state', collectionLabel('来源', report));
      text('node-' + name + '-raw', report.status === 'reported' ? '已解析的来源对象（不等同于原始字节）：\n' + JSON.stringify(report.data, null, 2) : '本项不可用；不会填入估计数据。');
    }
  } catch (error) { if (current(op)) { text('node-state', '节点报告未完成 · ' + error.message); for (const name of ['status', 'latestBlock', 'validators']) text('node-' + name + '-state', '未取得本次报告'); } }
  finally { finish(op); controls(); }
}
async function nativeStatus() {
  if (!paired) return;
  const op = begin('native', { requiresPair: true }); text('native-state', '正在读取本机 helper 的原生自检…'); text('native-peer', '本次凭据尚未提供'); text('native-raw', '');
  try {
    const value = await api('/api/native-status', {}, op); if (!current(op)) return;
    if (value.browserIdentityVerified !== false) throw new Error('BROWSER_IDENTITY_NOT_ESTABLISHED');
    const response = value.native, peer = response && response.peer;
    const verified = response && response.code === 'OK' && peer && peer.nativeIPCVerified === true && peer.browserIdentityVerified === false && Number.isInteger(peer.uid) && peer.uid >= 0 && peer.uid <= 4294967295;
    text('native-state', verified ? 'helper 原生自连接已通过内核凭据核对' : '原生自检不可用 · ' + (value.code || response && response.code || 'NATIVE_UNAVAILABLE'));
    text('native-peer', verified ? '原生调用方 UID ' + peer.uid + (Number.isInteger(peer.pid) && peer.pid > 0 ? ' · PID ' + peer.pid : ' · PID 未提供') + ' · ' + (peer.credentialSource || '来源未提供') : '没有可显示的已核对原生凭据');
    text('native-note', '浏览器 OS 身份：未验证。以上只描述 helper 的原生自连接；不构成网页管理权限或 Wallet 批准。' + (value.note ? ' ' + value.note : ''));
    text('native-raw', JSON.stringify(value, null, 2));
  } catch (error) { if (current(op)) { text('native-state', '原生状态未取得 · ' + error.message); text('native-peer', '没有本次已核对原生凭据'); } }
  finally { finish(op); }
}
function renderHistoryPage() {
  const list = $('receipt-list'); list.replaceChildren();
  for (const summary of receiptRows.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'history-row'; button.disabled = !paired;
    const tx = document.createElement('span'); tx.textContent = summary.txId;
    const details = document.createElement('span'); details.textContent = readableTime(summary.observedAt) + ' · 当时记录 ' + summary.reportedLevel;
    button.append(tx, details); button.addEventListener('click', () => openHistorical(summary.receiptId, summary.txId)); list.appendChild(button);
  }
  text('history-page', receiptRows.length ? '第 ' + (historyPage + 1) + '/' + Math.ceil(receiptRows.length / PAGE_SIZE) + ' 页' : ''); controls();
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
    text('history-state', rows.length ? '本机历史记录 ' + rows.length + ' 条 · 不授予当前权限；选中后读取原保存快照' : '本机尚无保存回执；完成一次真实查询后可在这里查回。');
  } catch (error) { if (current(op)) { receiptRows = []; historyPage = 0; renderHistoryPage(); text('history-state', '历史读取未完成 · ' + error.message); } }
  finally { finish(op); }
}
async function openHistorical(id, expectedTx) {
  if (!paired) return;
  invalidateEvidence('正在查回原保存回执…'); const op = begin('receipt', { requiresPair: true, receiptId: id, expectedTx });
  try {
    receiptID(id); const value = await api('/api/receipt', { id }, op); if (!current(op)) return;
    if (value.historical !== true || value.authority !== false) throw new Error('INVALID_HISTORY_AUTHORITY');
    renderReceipt(value.receipt, op, true);
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('历史回执未取得：' + error.message, true); } }
  finally { finish(op); }
}
async function status(refresh = true, announcePair = false) {
  const op = begin('status');
  try {
    const value = await api('/api/status', {}, op); if (!current(op)) return false;
    if (value.paired !== true || value.callerOsIdentityVerified !== false) throw new Error('INVALID_PAIRING_STATUS');
    paired = true; controls();
    const anchor = value.checkpoint;
    text('anchor-summary', value.pqIndependentTrustConfigured === true ? '本机已配置独立 PQ 验证入口；每笔仍须实际取回证据并通过核验。' : value.anchorConfigured && anchor ? '独立检查点 · ' + anchor.source + ' · 高度 ' + anchor.height + ' · 信任期至 ' + anchor.trustUntil : '独立上下文：未配置。将读取原证明来源，缺独立 Source 时保持 RPC_ONLY。');
    text('pair-state', '已配对本机 helper · 网页只读查证权限 · 浏览器 OS 身份未验证' + (value.version ? ' · ' + value.version : ''));
    const expiry = sessionStorage.getItem('ynxNetworkTicketExpires'); if (expiry) scheduleExpiry(expiry);
    if (announcePair) notice('配对完成。节点来源、原生自检和本机历史分别读取；查询交易将取回实际证明并显示本次层级。');
    if (refresh) await Promise.allSettled([nodeReport(), nativeStatus(), refreshHistory()]);
    return current(op) && paired;
  } catch (error) {
    if (current(op)) { paired = false; controls(); invalidateEvidence(); clearPanels(); text('pair-state', 'helper 连接尚未确认，请重开当前入口或使用新的配对码。'); notice('连接未确认：' + error.message, true); }
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
  } catch (error) { if (current(op)) notice('配对未完成：' + error.message, true); }
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
  } catch (error) { if (current(op)) clearPairing('本页票据已清除；helper 撤销结果未确认，请关闭该 helper。' + error.message); }
  finally { finish(op); }
});
$('lookup-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!paired) return;
  invalidateEvidence('正在读取裸交易报告与原证明来源，尚无本次结论。'); const op = begin('receipt', { requiresPair: true });
  try {
    op.txId = canonicalTx($('tx-id').value); $('lookup-button').disabled = true;
    const record = await api('/api/client-receipt', { txId: op.txId }, op); if (!current(op)) return;
    if (renderReceipt(record, op, false)) await refreshHistory();
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('本次回执未完成：' + error.message, true); } }
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
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('导入证明未通过：' + error.message, true); } }
  finally { finish(op); event.target.value = ''; }
});
$('node-refresh').addEventListener('click', nodeReport);
$('native-refresh').addEventListener('click', nativeStatus);
$('history-refresh').addEventListener('click', refreshHistory);
$('history-form').addEventListener('submit', event => { event.preventDefault(); return openHistorical($('receipt-id').value.trim()); });
$('history-prev').addEventListener('click', () => { if (paired && historyPage > 0) { historyPage--; renderHistoryPage(); } });
$('history-next').addEventListener('click', () => { if (paired && (historyPage + 1) * PAGE_SIZE < receiptRows.length) { historyPage++; renderHistoryPage(); } });
invalidateEvidence();
controls();
if (typeof window !== 'undefined') window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  epoch++; paired=false;abortAll();clearTimeout(expiryTimer);invalidateEvidence('页面已恢复，正在重新确认 helper 与当前票据。');clearPanels();controls();
  if (ticket) status();
});
if (ticket) status();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
