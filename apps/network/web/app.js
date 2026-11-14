'use strict';
const $ = id => document.getElementById(id);
const tr = (key, params) => typeof window !== 'undefined' && window.NetworkI18n ? window.NetworkI18n.t(key, params) : String(key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? '{'+k+'}'));
// Display copy only. Raw codes remain in folded diagnostics; capabilities and
// all parser/effect decisions continue to consume the original returned values.
const nodeCapacityMessage='节点存储达到限制。请检查节点状态与设备空间，释放空间后重新读取。';
const localStatusKeys=Object.freeze({CAPACITY_LIMIT:nodeCapacityMessage,NATIVE_RESPONSE_INVALID:'本次请求未完成，请查看详细报告。',NATIVE_TIMEOUT:'本次请求未完成，请查看详细报告。',INVALID:'本次请求未完成，请查看详细报告。',CONFLICT:'记录已变化，请手动刷新列表。',OK:'本机响应已收到。',UNSUPPORTED:'当前版本不支持此操作。',NOT_SUPPLIED:'当前接口未提供',NOT_CONFIGURED:'未配置',UNAVAILABLE:'不可用',NATIVE_UNAVAILABLE:'不可用',RESOURCE_UNAVAILABLE:'不可用',PARTICIPATION_UNAVAILABLE:'不可用',DISABLED:'已关闭',RETIRED:'已停止',CLEANUP_PENDING:'正在释放本机资源',RETIRED_WITH_PRIOR_FAILURE:'已释放本机资源，保留前次错误。',REVOKED:'已撤销本机参与会话。',UNKNOWN:'结果未确定。',CONFIGURED:'已装配，仍需 Wallet 批准。',CONTROLLED_SANDBOX:'本机隔离测试中。',NATIVE_REQUIRED:'需要 Network 原生 App',NATIVE_NOT_READY:'原生连接尚未就绪',NATIVE_BUSY:'请等待当前操作结束。',PREPARED:'请求已准备，等待审阅。',AWAITING_WALLET:'交由 Wallet 审阅',CANCELLED:'本机操作已取消。',DENIED:'本次操作未获批准。',UNSIGNED_PREVIEW_ONLY:'预览摘要不代表同意、签名、执行或奖励。',STALE:'记录已变化，请手动刷新列表。',NOT_FOUND:'未找到原任务记录。',RPC_REPORTED_COMMITTED:'来源报告已记录，尚未独立验证。',RPC_REPORTED_REJECTED:'来源报告已拒绝，尚未独立验证。'});
const statusKey=code=>Object.hasOwn(localStatusKeys,code)?localStatusKeys[code]:(code?'状态未识别，请查看原始报告。':'—');
const localActionKeys=Object.freeze({delegate:'委托',unbond:'解除委托',withdraw:'提取解押',vote:'投票'});
const actionKey=action=>Object.hasOwn(localActionKeys,action)?localActionKeys[action]:'状态未识别，请查看原始报告。';
const proposalStatusText=code=>{const keys=Object.assign(Object.create(null),{draft:'草稿',eligibility_check:'正在核对',deposit_pending:'等待登记保证金',deposit_accepted:'保证金已登记',discussion:'讨论中',technical_review:'正在核对',economic_review:'正在核对',security_review:'正在核对',conflict_disclosure:'正在核对',simulation_pending:'准备中',simulation_completed:'模拟已完成',voting_pending:'等待投票',voting:'投票中',voting_active:'投票中',voting_closed:'投票已结束',quorum_failed:'投票条件未达标',threshold_failed:'投票条件未达标',approved:'已批准',rejected:'已拒绝',cancelled:'已取消',expired:'已过期',timelock_pending:'等待执行',timelock_active:'等待执行',execution_ready:'等待执行',execution_submitted:'已提交，等待核对',executed:'已执行',verification_pending:'正在核对',verified:'来源已核对',execution_failed:'执行失败',rollback_pending:'等待回滚',rolled_back:'已回滚',emergency_paused:'已暂停',corrected:'已更正',archived:'已归档'});const key=keys[code];return key?tr('来源报告：{status}',{status:tr(key)}):tr('状态未识别，请查看原始报告。');};
const textBindings = new Map();
function paint(el, key, params) { const render=typeof key==='function'?key:()=>tr(key,params); textBindings.set(el,render); el.removeAttribute?.('data-i18n'); el.textContent=render(); }
function publish(channel,value) { if(typeof window !== 'undefined')window.NetworkUI?.receive(channel,value); }
let historyFilter='all';
const proofCollectionMessages = Object.freeze({
  PROOF_PENDING: '证明来源仍在等待后继区块。请稍后重新查询同一笔交易。',
  PROOF_NOT_SUPPLIED: '证明来源未提供这笔交易的原始证明。如已取得与交易匹配的原始证明，可手动导入。',
  RPC_HTTP_ERROR: '证明来源返回 HTTP 错误。请稍后重新查询。',
  INVALID_PROOF_SOURCE_RESPONSE: '证明来源返回无法读取的证明。请重新获取与这笔交易匹配的原始证明。',
});
const reasonMessages=Object.freeze({...proofCollectionMessages,NOT_SUPPLIED:'独立证明或信任材料尚未提供。',EXPIRED:'独立检查点已过期。请获取新的原 CORE 信任上下文和独立 SHA-256，再重新配置并核验。',TRUST_CONTEXT_INVALID:'信任上下文未通过核验。请核对原文件和独立 SHA-256，再重新配置。',TRUST_SOURCE_INVALID:'检查点引用的原文件未通过核验。请恢复原文件，或获取新的完整信任材料和独立 SHA-256。',TRUST_CLOCK_UNAVAILABLE:'无法读取本机核验时间。请检查系统时间后重试。',INVALID_PROOF_REQUEST:'原 CORE 无法读取这份证明。请重新获取与当前交易和信任上下文匹配的完整原证明。',BAD_PROOF:'证明未通过核验，原始原因见交易详情。',CANCELLED:'本次核验已取消或超时。',REVOKED:'本机证明通道已关闭。',STATE_NOT_PROVEN:'资金、账户与发票状态尚未验证；ABCI 成功不等于到账证明'});
const reasonKey=reason=>Object.hasOwn(reasonMessages,reason)?reasonMessages[reason]:null;
const reasonText=view=>tr(reasonKey(view.reason)||view.detail||'未提供');
const levels = ['RPC_ONLY', 'HEADER_VERIFIED', 'INCLUSION_VERIFIED', 'STATE_VERIFIED'];
const pending = new Map();
let ticket = sessionStorage.getItem('ynxNetworkTicket') || '';
let epoch = 0;
let paired = false;
let expiryTimer;
let checkpointDisplayTimer;
let nodeSnapshot = null;
let receiptRows = [];
let historyPage = 0;
let showingHistoricalReceipt = false;
const PAGE_SIZE = 20;
const txKey = value => String(value || '').trim().toLowerCase().replace(/^0x/, '');
function canonicalTx(value) { const hash = txKey(value); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_TX_ID'); return '0x' + hash; }
function receiptID(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('INVALID_RECEIPT_ID'); return value; }
function text(id, value, params) { paint($(id), value, params); }
function notice(value, error = false, params) { text('notice', value, params); $('notice').classList.toggle('error', error); publish('notice',{key:value,error,params}); }
function controls() {
  for (const id of ['proof-file']) $(id).disabled = !paired;
  for (const [id,channel] of [['lookup-button','receipt'],['history-open','receipt'],['node-refresh','node'],['overview-refresh','node'],['native-refresh','native'],['participation-refresh','native'],['resource-refresh','native'],['history-refresh','history'],['governance-refresh','governance']]) $(id).disabled = !paired || pending.has(channel);
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
  showingHistoricalReceipt = false;
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
function renderProofSetupGuide() {
  const key = window.NetworkNative?.available === true
    ? '在本窗口顶部选择「{button}」，使用这笔交易对应的 CORE 公开上下文和从独立可信渠道取得的 SHA-256。'
    : '请在 macOS 的 Network App 中配置。在窗口顶部选择「{button}」，使用这笔交易对应的 CORE 公开上下文和从独立可信渠道取得的 SHA-256。';
  text('anchor-setup-guide', () => tr(key, {button: tr('独立证明材料…')}) + ' ' +
    tr('经典 CometBFT 交易请选择「{checkpoint}」，并提供原检查点文件及其独立 SHA-256。',{checkpoint:tr('经典 CometBFT 检查点')}));
}
function resetProofConfiguration(){
  clearTimeout(checkpointDisplayTimer);
  checkpointDisplayTimer=undefined;
  text('anchor-summary','独立上下文：尚未确认。RPC 查询不会自行取得独立验证标识。');
}
function renderProofConfiguration(value) {
  clearTimeout(checkpointDisplayTimer);
  checkpointDisplayTimer=undefined;
  const currentEpoch=epoch, currentTicket=ticket;
  const pq=value.pqIndependentTrustConfigured===true;
  const anchor=value.checkpoint;
  let classic;
  if(value.anchorConfigured===true&&receiptObject(anchor))try{
    const source=receiptText(anchor.source,4096);
    if(!source.trim()||typeof anchor.height!=='string'||!/^[1-9][0-9]{0,18}$/.test(anchor.height)||
       BigInt(anchor.height)>9223372036854775807n)throw new Error('INVALID_CHECKPOINT_SUMMARY');
    const until=receiptTimestamp(anchor.trustUntil);
    // Date.now() is integral milliseconds. A nonzero sub-millisecond tail
    // moves the display transition to the next representable clock tick.
    const fractional=until.match(/\.(\d{4,})(?:Z|[+-])/);
    const expiry=Date.parse(until)+Number(!!fractional&&/[1-9]/.test(fractional[1].slice(3)));
    classic={source,height:anchor.height,until,expiry};
  }catch{/* The helper configuration cannot be described from a malformed summary. */}
  const render=()=>{
    const messages=[];
    if(pq)messages.push(tr('已配置独立 PQ 上下文。只适用于该上下文指定的交易，仍需核验实际证明。'));
    if(value.anchorConfigured===true){
      if(!classic)messages.push(tr('无法确认经典 CometBFT 检查点的配置。请在本机服务中重新检查。'));
      else if(Date.now()>=classic.expiry)messages.push(tr('按此设备时间，经典 CometBFT 检查点已到期（{until}）。请更新原检查点，实际核验以本机服务为准。',{until:classic.until}));
      else messages.push(tr('经典 CometBFT 检查点 · {source} · 高度 {height} · 信任期至 {until}。与 PQ 上下文分别配置。',classic)+
        ' '+tr('配置材料后仍需核验实际证明。'));
    }
    return messages.join(' ')||tr('未配置独立检查点或 PQ 上下文。核验结果保持 RPC_ONLY。');
  };
  function update(){
    if(!paired||epoch!==currentEpoch||ticket!==currentTicket)return;
    text('anchor-summary',render);
    const remaining=classic?.expiry-Date.now();
    if(remaining>0)checkpointDisplayTimer=setTimeout(update,Math.min(remaining,24*60*60*1000));
  }
  update();
}
function clearPanels() {
  nodeSnapshot = null;
  clearGovernance();
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
  resetProofConfiguration();
  renderProofSetupGuide();
}
function clearPairing(message) {
  epoch++; paired = false; ticket = ''; abortAll(); clearTimeout(expiryTimer);
  sessionStorage.removeItem('ynxNetworkTicket'); sessionStorage.removeItem('ynxNetworkTicketExpires');
  invalidateEvidence(); clearPanels(); controls(); text('pair-state', message); notice(message);
}
function api(path, body, op, signal) {
  return postJSON(path, JSON.stringify(body || {}), op, signal);
}
async function postJSON(path, body, op, signal = op.controller.signal) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(op.ticket ? { Authorization: 'Bearer ' + op.ticket } : {}) },
    body, cache: 'no-store', credentials: 'omit', signal
  });
  if (response.status === 401) {
    if (current(op) && !signal.aborted) clearPairing('配对已过期、已撤销或 helper 已重启。请使用当前 helper 的一次性配对码重新连接。');
    throw new Error('PAIRING_REQUIRED');
  }
  let result;
  try { result = await response.json(); }
  catch (error) { if (error && typeof error === 'object') error.httpStatus = response.status; throw error; }
  if (!response.ok) throw Object.assign(new Error(typeof result?.error === 'string' ? result.error : 'REQUEST_FAILED'), {httpStatus:response.status});
  return result;
}
async function readNodeReport(op) {
  // The helper bounds RPC collection at 18s. Bound the complete browser read
  // (including JSON body consumption) with transport margin, so a stalled
  // local connection cannot hold the shared homepage refresh controls forever.
  const transport = new AbortController();
  let timer, closed = false;
  const stop = {};
  const deadline = new Promise((_, reject) => {
    stop.cancel = () => { if (!closed) { transport.abort(); reject(new Error('NODE_REPORT_CANCELLED')); } };
    op.controller.signal.addEventListener('abort', stop.cancel, {once:true});
    if (op.controller.signal.aborted) stop.cancel();
    timer = setTimeout(() => { if (!closed) { transport.abort(); reject(new Error('NODE_REPORT_TIMEOUT')); } }, 25000);
  });
  try { return await Promise.race([api('/api/node-report', {}, op, transport.signal), deadline]); }
  finally { closed = true; clearTimeout(timer); op.controller.signal.removeEventListener('abort', stop.cancel); }
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
function collectionLabel(label, value, descriptions = {}) { return () => {
  if (!value || (value.status !== 'reported' && value.status !== 'unavailable')) return tr('{label}：未提供来源状态',{label:tr(label)});
  const description = Object.hasOwn(descriptions, value.code) ? descriptions[value.code] : null;
  return tr('{label}：{state}{code}{source}', {
    label: tr(label),
    state: tr(description || (value.status === 'reported' ? '已取回，仅表示来源返回' : '不可用')),
    code: value.code ? ' · ' + value.code : '',
    source: value.source ? ' · ' + value.source : '',
  });
}; }
const receiptObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const receiptOwn = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const receiptMetadataLimit = 8 * 1024 * 1024;
function receiptText(value,limit=receiptMetadataLimit) {
  if (typeof value !== 'string' || value.length > limit || new TextEncoder().encode(value).length > limit) throw new Error('INVALID_HISTORY_FIELDS');
  return value;
}
function receiptTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) throw new Error('INVALID_HISTORY_TIME');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error('INVALID_HISTORY_TIME');
  const [year,month,day,hour,minute,second] = match.slice(1,7).map(Number),leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (!year || month<1 || month>12 || day<1 || day>days[month-1] || hour>23 || minute>59 || second>59 || match[7]!=='Z'&&(Number(match[7].slice(1,3))>23||Number(match[7].slice(4))>59) || !Number.isFinite(Date.parse(value))) throw new Error('INVALID_HISTORY_TIME');
  return value; // Preserve original offset and nanoseconds for immutable binding.
}
function receiptSummary(value,budget) {
  if (!receiptObject(value) || !['receiptId','txId','observedAt','reportedLevel'].every(key=>receiptOwn(value,key)) || typeof value.txId !== 'string') throw new Error('INVALID_HISTORY_FIELDS');
  receiptID(value.receiptId); canonicalTx(value.txId); receiptTimestamp(value.observedAt);
  if (!levels.includes(value.reportedLevel)) throw new Error('INVALID_HISTORY_LEVEL');
  const result={receiptId:value.receiptId,txId:value.txId,observedAt:value.observedAt,reportedLevel:value.reportedLevel};
  for (const key of ['source','reason','detail']) if (receiptOwn(value,key)) result[key]=receiptText(value[key],key==='source'?4096:receiptMetadataLimit);
  for (const value of Object.values(result)) budget.bytes+=new TextEncoder().encode(value).length;
  if (budget.bytes>receiptMetadataLimit) throw new Error('INVALID_HISTORY_FIELDS');
  return Object.freeze(result);
}
function historicalReceipt(record) {
  if (!receiptObject(record) || !['receiptId','txId','observedAt','contextPin','view'].every(key=>receiptOwn(record,key)) || typeof record.txId !== 'string' || !receiptObject(record.view)) throw new Error('INVALID_HISTORY_FIELDS');
  receiptID(record.receiptId); canonicalTx(record.txId); receiptTimestamp(record.observedAt); receiptText(record.contextPin,64);
  const view=record.view;
  if (!receiptOwn(view,'txId') || !receiptOwn(view,'level') || typeof view.txId !== 'string' || view.txId!==record.txId) throw new Error('RECEIPT_TX_MISMATCH');
  let bytes=0;
  for (const key of ['height','source','reason','detail','requestedMember','requestedEvent','executionOutcome','abciExecutionCode','selectedMemberOutcome','stateScope']) if (receiptOwn(view,key)) {
    receiptText(view[key],key==='height'?20:key==='source'?4096:receiptMetadataLimit);bytes+=new TextEncoder().encode(view[key]).length;
  }
  if (bytes>receiptMetadataLimit) throw new Error('INVALID_HISTORY_FIELDS');
  for (const key of ['memberVerified','executionVerified','abciResultVerified','selectedMemberResultVerified','fundsVerified','nativeGrant']) if (receiptOwn(view,key)&&typeof view[key]!=='boolean') throw new Error('INVALID_HISTORY_FIELDS');
  for (const key of ['reportText','reportedBy']) if (receiptOwn(record,key)) receiptText(record[key],key==='reportedBy'?4096:receiptMetadataLimit);
  // These fields are saved RawMessage JSON, not new trust. Validate the fields
  // actually consumed by the collection label; other original JSON stays raw.
  for (const key of ['reportCollection','proofCollection']) if (receiptObject(record[key])) {
    const collection=record[key];
    if (receiptOwn(collection,'status')&&!['reported','unavailable'].includes(collection.status)) throw new Error('INVALID_HISTORY_FIELDS');
    for (const field of ['source','code']) if (receiptOwn(collection,field)) receiptText(collection[field],field==='source'?4096:receiptMetadataLimit);
  }
}
function bindReceiptSummary(record,summary) {
  if (!summary) return;
  if (summary.receiptId!==record.receiptId || summary.txId!==record.txId || summary.observedAt!==record.observedAt || summary.reportedLevel!==record.view.level || ['source','reason','detail'].some(key=>receiptOwn(summary,key)&&summary[key]!== (receiptOwn(record.view,key)?record.view[key]:''))) throw new Error('RECEIPT_SUMMARY_MISMATCH');
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
const executionOutcomeLabels=Object.freeze({succeeded:'执行成功',rejected:'执行被拒绝',partial:'仅部分批次成员获接纳'});
const memberOutcomeLabels=Object.freeze({admitted:'已获接纳',rejected:'已拒绝'});
function proofOutcomeLabel(labels, outcome, fallback) {
  return tr(Object.hasOwn(labels,outcome)?labels[outcome]:fallback);
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
  text('execution-result',()=>tr(historical?'历史记录中：{result}':'{result}',{result:abci?tr(historical?'确定性 ABCI 结果当时记录为已核验 · {outcome}{code}':'确定性 ABCI 结果已核验 · {outcome}{code}',{outcome:proofOutcomeLabel(executionOutcomeLabels,view.executionOutcome,'结果未说明'),code:view.abciExecutionCode?' · code '+view.abciExecutionCode:''}):tr('尚未验证确定性 ABCI 执行结果')}));
  text('member-result',()=>tr(historical?'历史记录中：{result}':'{result}',{result:view.selectedMemberResultVerified===true?tr(historical?'指定成员结果当时已核验 · {outcome}':'指定成员结果已核验 · {outcome}',{outcome:proofOutcomeLabel(memberOutcomeLabels,view.selectedMemberOutcome,'未说明')}):tr('尚未验证指定成员的执行结果')}));
  text('funds-result', historical ? '历史记录不证明当前资金、账户或发票状态' : view.level === 'STATE_VERIFIED' && view.fundsVerified === true ? '本次具体资金状态已有对应证明；授权仍独立' : '资金、账户与发票状态尚未验证；ABCI 成功不等于到账证明');
  if (!historical) notice(reasonKey(view.reason)||'已显示本次可证明层级。缺少的证明不会被推断为成功。');
  return true;
}
function renderReceipt(record, op, historical) {
  if (!current(op)) return false;
  if (historical) { historicalReceipt(record); bindReceiptSummary(record,op.expectedSummary); }
  const id = receiptID(record && record.receiptId), txId = canonicalTx(record.txId);
  if (op.receiptId && op.receiptId !== id || op.expectedTx && txKey(op.expectedTx) !== txKey(txId)) throw new Error('RECEIPT_ID_MISMATCH');
  if (!historical && txKey(txId) !== txKey(op.txId)) throw new Error('RECEIPT_TX_MISMATCH');
  validateView(record.view, txId, historical);
  if (historical) $('tx-id').value = txId;
  if (!renderView(record.view, op, { historical, txId })) return false;
  $('receipt-id').value = id;
  text('meta-receipt', id); text('meta-time',()=>readableTime(record.observedAt)); text('meta-context', record.contextPin || '未提供；历史标识不授予当前权限');
  text('collection-report', collectionLabel('裸交易报告', record.reportCollection));
  text('collection-proof', collectionLabel('证明来源', record.proofCollection, proofCollectionMessages));
  const exactReport = typeof record.reportText === 'string';
  const hasReport = exactReport || Object.prototype.hasOwnProperty.call(record, 'report');
  $('raw-panel').hidden = !hasReport;
  text('raw-report', exactReport ? record.reportText : hasReport ? JSON.stringify(record.report, null, 2) : '');
  text('raw-label', exactReport ? historical ? '查看保存时的原始 RPC 报告（历史快照）' : '查看本次原始 RPC 报告' : '查看已解析的 RPC 对象（原始字节未保存）');
  if (historical) notice('已查回原保存回执。历史层级、上下文标识和原始报告不代表当前授权、当前信任期或资金到账；可重新查询交易作本次核验。');
  showingHistoricalReceipt = historical;
  publish('receipt',{record,historical});
  return true;
}
async function nodeReport() {
  if (!paired) return;
  const retained = nodeSnapshot?.epoch === epoch && nodeSnapshot.ticket === ticket ? nodeSnapshot : null;
  const op = begin('node', { requiresPair: true });
  if (!retained) {
    nodeSnapshot = null; publish('node',null); text('node-source', '');
    for (const name of ['status', 'latestBlock', 'validators']) { text('node-' + name + '-state', '正在读取'); text('node-' + name + '-raw', ''); }
  }
  publish('networkState',retained?'refreshing':'loading'); text('node-state',retained?'正在刷新；继续显示上次报告及原时间。':'正在查询固定 RPC 源…');
  try {
    const value = await readNodeReport(op); if (!current(op)) return;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.classification !== 'RPC_ONLY' || !value.reports || typeof value.reports !== 'object' || Array.isArray(value.reports)) throw new Error('INVALID_NODE_REPORT');
    const names = ['status', 'latestBlock', 'validators'];
    for (const name of names) {
      const report = value.reports[name];
      if (!report || (report.status !== 'reported' && report.status !== 'unavailable')) throw new Error('INVALID_NODE_REPORT');
    }
    const model = window.NetworkOverview.project(value, null);
    const {status, latestBlock, validators} = model;
    const usable = {
      status: status !== null && (status.height !== null || status.catchingUp !== null || status.pendingTxCount !== null ||
        (status.readyValidatorCount !== null && status.validatorCount !== null)),
      latestBlock: Boolean(latestBlock?.hash),
      validators: validators !== null && (validators.count === '0' || validators.items.some(item=>item.address !== null))
    };
    let reported = 0;
    text('node-source', value.source || '来源未提供');
    for (const name of names) {
      const report = value.reports[name];
      if (usable[name]) reported++;
      const diagnostic = report.status === 'reported' && !usable[name]
        ? {...report,status:'unavailable',code:model.reports[name].code || 'INVALID_REPORT_DATA'}
        : report;
      text('node-' + name + '-state', collectionLabel('来源', diagnostic));
      text('node-' + name + '-raw',report.status==='reported'?'已解析的来源对象（不等同于原始字节）：\n{report}':'本项不可用；不会填入估计数据。',{report:JSON.stringify(report.data,null,2)});
    }
    // Without usable data, receivedAt dates this attempt. Keep the original
    // snapshot and its timestamp so its expiry remains accurate.
    if (reported === 0) {
      publish('networkState',retained?'refresh-failed':'failed');
      text('node-state',retained?'刷新未完成；继续显示上次报告及原时间。':'RPC 暂不可用，请刷新重试。');
      return;
    }
    nodeSnapshot = {epoch:op.epoch,ticket:op.ticket,value};
    publish('node',value);publish('networkState',reported===3?'ready':'partial'); text('node-state','仅 RPC 返回 · {count}/3 项来源可读；不构成独立验证',{count:reported});
  } catch (error) { if (current(op)) {
    if (error.httpStatus === 403) { clearPairing('helper 连接尚未确认，请重开当前入口或使用新的配对码。'); return; }
    const invalid = error.message === 'INVALID_NODE_REPORT' || error.name === 'SyntaxError';
    if (invalid || !retained) {
      nodeSnapshot = null; publish('node',null); text('node-source', '');
      for (const name of ['status', 'latestBlock', 'validators']) { text('node-' + name + '-state', '未取得本次报告'); text('node-' + name + '-raw', ''); }
    }
    publish('networkState',retained&&!invalid?'refresh-failed':'failed');
    text('node-state',()=>[retained&&!invalid?tr('刷新未完成；继续显示上次报告及原时间。'):'',tr('节点报告未完成 · {error}',{error:error.message})].filter(Boolean).join(' '));
  } }
  finally { finish(op); controls(); }
}
async function nativeStatus() {
  if (!paired) return;
  const resourceRead=window.NetworkOperations?.beginResourceSelfRead();
  publish('native',null); const op = begin('native', { requiresPair: true }); text('native-state', '正在读取本机 helper 的原生自检…'); text('native-peer', '本次凭据尚未提供'); text('native-raw', '');
  try {
    const value = await api('/api/native-status', {}, op); if (!current(op)) return;
    if (value.browserIdentityVerified !== false) throw new Error('BROWSER_IDENTITY_NOT_ESTABLISHED');
    const response = value.native, peer = response && response.peer;
    const verified = response && response.code === 'OK' && peer && peer.nativeIPCVerified === true && peer.browserIdentityVerified === false && Number.isInteger(peer.uid) && peer.uid >= 0 && peer.uid <= 4294967295;
    window.NetworkOperations?.finishResourceSelfRead(resourceRead,verified?value:null);
    publish('native',value); text('native-state',verified?'helper 原生自连接已通过内核凭据核对':'不可用');
    text('native-peer',()=>verified?tr('原生调用方 UID {uid} · PID {pid} · {source}',{uid:peer.uid,pid:Number.isInteger(peer.pid)&&peer.pid>0?peer.pid:tr('未提供'),source:peer.credentialSource||tr('来源未提供')}):tr('没有可显示的已核对原生凭据'));
    text('native-note','浏览器 OS 身份：未验证。以上只描述 helper 的原生自连接；不构成网页管理权限或 Wallet 批准。');
    text('native-raw', JSON.stringify(value, null, 2));
  } catch (error) { if (current(op)) { window.NetworkOperations?.finishResourceSelfRead(resourceRead,null);publish('native',{native:null,browserIdentityVerified:false,code:'NATIVE_UNAVAILABLE'}); text('native-state','不可用');text('native-raw',JSON.stringify({readError:error.message},null,2)); text('native-peer', '没有本次已核对原生凭据'); } }
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
    button.append(details, tx, level, source, reason, action); button.addEventListener('click', () => openHistorical(summary.receiptId, summary.txId,summary)); list.appendChild(button);
  }
  text('history-page',filtered.length?'第 {page}/{pages} 页':'',{page:historyPage+1,pages:Math.ceil(filtered.length/PAGE_SIZE)}); controls();
  $('history-next').disabled=!paired||(historyPage+1)*PAGE_SIZE>=filtered.length;
}
function handleReceiptStoreUnavailable(error) {
  if (error.httpStatus !== 503 || error.message !== 'RECEIPTS_UNAVAILABLE') return false;
  abort('history');
  receiptRows = [];
  historyPage = 0;
  if (showingHistoricalReceipt || pending.get('receipt')?.historical === true) {
    invalidateEvidence();
    notice('历史回执未取得：{error}',true,{error:error.message});
  }
  renderHistoryPage();
  text('history-state','历史读取未完成 · {error}',{error:error.message});
  return true;
}
async function refreshHistory() {
  if (!paired) return;
  const op = begin('history', { requiresPair: true }); text('history-state', '正在读取本机保存的回执标识…');
  try {
    const value = await api('/api/receipts', {}, op); if (!current(op)) return;
    if (!receiptObject(value) || value.classification !== 'historical-local-projection' || value.authority !== false || !Array.isArray(value.receipts) || value.receipts.length > 2048) throw new Error('INVALID_HISTORY_AUTHORITY');
    const budget={bytes:0},rows = value.receipts.map(row => receiptSummary(row,budget));
    const unique = new Set(rows.map(row => row.receiptId)); if (unique.size !== rows.length) throw new Error('DUPLICATE_RECEIPT_ID');
    receiptRows = rows; historyPage = 0; renderHistoryPage();
    text('history-state',rows.length?'本机历史记录 {count} 条 · 不授予当前权限；选中后读取原保存快照':'本机尚无保存回执；完成一次真实查询后可在这里查回。',{count:rows.length});
  } catch (error) {
    if (current(op) && !handleReceiptStoreUnavailable(error)) {
      receiptRows = [];
      historyPage = 0;
      renderHistoryPage();
      text('history-state','历史读取未完成 · {error}',{error:error.message});
    }
  }
  finally { finish(op); }
}
async function openHistorical(id, expectedTx, expectedSummary) {
  if (!paired) return;
  invalidateEvidence('正在查回原保存回执…'); const op = begin('receipt', { requiresPair: true, historical: true, receiptId: id, expectedTx,expectedSummary:expectedSummary||receiptRows.find(row=>row.receiptId===id) });
  try {
    receiptID(id); const value = await api('/api/receipt', { id }, op); if (!current(op)) return;
    if (!receiptObject(value) || value.historical !== true || value.authority !== false) throw new Error('INVALID_HISTORY_AUTHORITY');
    renderReceipt(value.receipt, op, true);
  } catch (error) {
    if (current(op) && !handleReceiptStoreUnavailable(error)) {
      invalidateEvidence();
      notice('历史回执未取得：{error}',true,{error:error.message});
    }
  }
  finally { finish(op); }
}
let governanceListModel=null,governanceDetailModel=null,governanceSelected=null,governanceListPhase='idle',governanceDetailPhase='idle',governanceTimer;
const governanceMessages={idle:'读取治理提案',loading:'正在读取',EMPTY:'暂无治理提案',UNSUPPORTED:'治理接口未开放',UNAVAILABLE:'治理服务暂时不可用',ACCESS_RESTRICTED:'治理来源限制访问。',METHOD_NOT_ALLOWED:'治理来源不接受此查询方式。',INVALID_RESPONSE:'治理响应无效',NOT_FOUND:'未找到该提案',NOT_CONFIGURED:'治理来源未配置',stale:'报告已过期，请刷新。'};
function clearGovernance(){clearTimeout(governanceTimer);governanceListModel=null;governanceDetailModel=null;governanceSelected=null;governanceListPhase='idle';governanceDetailPhase='idle';renderGovernance();}
function governanceMeta(model){return model?[[tr('数据来源'),model.endpoint],[tr('报告时间'),model.asOf?readableTime(model.asOf):tr('未提供')],[tr('读取时间'),readableTime(model.observedAt)],[tr('响应摘要（非信任锚）'),model.responseSHA256||tr('未提供')]].map(([key,value])=>key+' · '+value).join('\n'):'';}
function renderGovernance(){
  const list=$('governance-list'),panel=$('governance-detail');if(!list||!panel)return;
  clearTimeout(governanceTimer);const now=Date.now();
  if(governanceListModel&&now-Date.parse(governanceListModel.observedAt)>=60000){governanceListModel=null;governanceDetailModel=null;governanceSelected=null;governanceListPhase='stale';governanceDetailPhase='idle';abort('governance-detail');}
  if(governanceDetailModel&&now-Date.parse(governanceDetailModel.observedAt)>=60000){governanceDetailModel=null;governanceDetailPhase='stale';}
  const next=[governanceListModel,governanceDetailModel].filter(Boolean).map(v=>Date.parse(v.observedAt)+60000-now);if(next.length)governanceTimer=setTimeout(renderGovernance,Math.max(1,Math.min(...next)));
  const model=governanceListModel;
  text('governance-state',governanceMessages[governanceListPhase]||governanceMessages[model?.code]||'只读登记报告，不证明链上最终确认或投票资格。');
  $('governance-meta').textContent=governanceMeta(model);
  list.replaceChildren();
  for(const row of model?.proposals||[]){const button=document.createElement('button');button.type='button';button.className='governance-row';button.disabled=!paired;button.setAttribute('aria-label',row.summary+' · '+tr('治理提案详情'));const summary=document.createElement('span');summary.textContent=row.summary||row.id;const state=document.createElement('span');state.className='proposal-status';state.textContent=proposalStatusText(row.status);const time=document.createElement('time');time.dateTime=row.updatedAt;time.textContent=readableTime(row.updatedAt);const open=document.createElement('span');open.className='proposal-open';open.textContent=tr('治理提案详情');button.append(summary,state,time,open);button.addEventListener('click',()=>loadGovernanceDetail(row.id));list.append(button);}
  text('governance-count',model?.truncated?'仅显示本次取回的 {shown} / {total} 项。':'',model?{shown:model.returnedCount,total:model.reportedCount}:undefined);
  panel.hidden=governanceDetailPhase==='idle'&&!governanceDetailModel;
  const detail=governanceDetailModel;
  text('governance-detail-state',governanceMessages[governanceDetailPhase]||governanceMessages[detail?.code]||'只读登记报告，不证明链上最终确认或投票资格。');
  $('governance-detail-meta').textContent=governanceMeta(detail);
  const fields=$('governance-fields');fields.replaceChildren();$('governance-use-proposal').disabled=!paired||!detail?.proposal||window.NetworkOperations?.canSelectProposal()!==true;
  if(detail?.proposal){const p=detail.proposal;for(const [key,value]of [['提案标识',p.id],['发起者',p.proposer],['提案类型',p.proposalType],['范围',p.scope],['状态',proposalStatusText(p.status)],['登记保证金',p.deposit],['登记合格投票权',p.eligiblePower],['投票截止',p.votingEndsAt?readableTime(p.votingEndsAt):tr('未提供')]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=tr(key);dd.textContent=value;fields.append(dt,dd);}}
  $('governance-raw').textContent=detail?.rawJSON||'';
  $('governance-raw-panel').hidden=!detail?.rawJSON;
  if(!detail?.rawJSON)$('governance-raw-panel').open=false;
}
async function loadGovernance(){
  if(!paired||!window.NetworkGovernance)return;
  const op=begin('governance',{requiresPair:true});abort('governance-detail');governanceListModel=null;governanceDetailModel=null;governanceSelected=null;governanceListPhase='loading';governanceDetailPhase='idle';renderGovernance();
  try{const raw=await api('/api/governance-proposals',{},op);if(!current(op))return;const model=window.NetworkGovernance.projectList(raw);if(!model||Date.parse(model.observedAt)>Date.now()+5000)throw new Error('INVALID_RESPONSE');governanceListModel=model;governanceListPhase=model.code;}
  catch(error){if(current(op)){governanceListModel=null;governanceListPhase=error.message==='INVALID_RESPONSE'?'INVALID_RESPONSE':'UNAVAILABLE';}}
  finally{if(current(op))renderGovernance();finish(op);}
}
async function loadGovernanceDetail(id){
  if(!paired||!governanceListModel?.proposals.some(row=>row.id===id)||!window.NetworkGovernance)return;
  const op=begin('governance-detail',{requiresPair:true});governanceSelected=id;governanceDetailModel=null;governanceDetailPhase='loading';$('governance-raw-panel').open=false;renderGovernance();if(!current(op)||governanceSelected!==id){finish(op);return;}
  try{const raw=await api('/api/governance-proposal',{id},op);if(!current(op)||governanceSelected!==id)return;const model=window.NetworkGovernance.projectDetail(raw,id);if(!model||Date.parse(model.observedAt)>Date.now()+5000)throw new Error('INVALID_RESPONSE');governanceDetailModel=model;governanceDetailPhase=model.code;}
  catch(error){if(current(op)&&governanceSelected===id){governanceDetailModel=null;governanceDetailPhase=error.message==='INVALID_RESPONSE'?'INVALID_RESPONSE':'UNAVAILABLE';}}
  finally{if(current(op)&&governanceSelected===id)renderGovernance();finish(op);}
}

async function status(refresh = true, announcePair = false) {
  const op = begin('status');
  try {
    const value = await api('/api/status', {}, op); if (!current(op)) return false;
    if (value.paired !== true || value.callerOsIdentityVerified !== false) throw new Error('INVALID_PAIRING_STATUS');
    paired = true; controls(); publish('status',value);
    renderProofConfiguration(value);
    renderProofSetupGuide();
    text('pair-state','已配对本机 helper · 网页只读查证权限 · 浏览器 OS 身份未验证{version}',{version:value.version?' · '+value.version:''});
    const expiry = sessionStorage.getItem('ynxNetworkTicketExpires'); if (expiry) scheduleExpiry(expiry);
    if (announcePair) notice('配对完成。节点来源、原生自检和本机历史分别读取；查询交易将取回实际证明并显示本次层级。');
    if (refresh) await Promise.allSettled([nodeReport(), nativeStatus(), refreshHistory(), ...(window.NetworkGovernance?[loadGovernance()]:[])]);
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
    // The receipt is complete. The history refresh owns its own request and controls.
    if (renderReceipt(record, op, false)) void refreshHistory();
  } catch (error) { if (current(op)) { invalidateEvidence(); notice('本次回执未完成：{error}',true,{error:error.message}); } }
  finally { finish(op); controls(); }
});
$('proof-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || !paired) return;
  invalidateEvidence('正在使用本机真实验证入口核对导入证明…'); const op = begin('receipt', { requiresPair: true }); text('proof-file-name', file.name);
  const invalidFile = new Error('INVALID_PROOF_FILE');
  try {
    op.txId = canonicalTx($('tx-id').value); if (file.size > 3 * 1024 * 1024) throw new Error('证明文件超过 3 MiB');
    const bytes = await file.arrayBuffer(); if (!current(op)) return;
    // Keep a BOM visible to the syntax check and reject invalid UTF-8. The
    // verifier must receive the original JSON, including duplicate key and
    // numeric representations, so it can enforce its own input contract.
    let proof;
    try {
      proof = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      JSON.parse(proof); // Check for one JSON value without consuming the result.
    } catch {
      throw invalidFile;
    }
    const body = '{"txId":' + JSON.stringify(op.txId) + ',"proof":' + proof + '}';
    const view = await postJSON('/api/verify', body, op);
    if (renderView(view, op)) { text('collection-report', '导入证明：未查询裸 RPC 报告'); text('collection-proof', '导入内容只作待核对证明；不导入独立信任或权限'); }
  } catch (error) {
    if (current(op)) {
      invalidateEvidence();
      if (error === invalidFile) {
        notice('导入证明未通过：请选择一个使用 UTF-8 编码的有效 JSON 证明文件。', true);
      } else if (error.httpStatus === 400 && ['INVALID_PROOF', 'INVALID_JSON'].includes(error.message)) {
        notice('导入证明未通过：请选择与当前交易匹配的完整原始证明 JSON 文件。', true);
      } else {
        notice('导入证明未通过：{error}', true, { error: error.message });
      }
    }
  }
  finally { finish(op); event.target.value = ''; }
});
$('node-refresh').addEventListener('click', nodeReport);
$('governance-refresh').addEventListener('click', loadGovernance);
$('governance-use-proposal').addEventListener('click',()=>{renderGovernance();if(paired&&governanceDetailModel?.proposal)window.NetworkOperations?.selectProposal(governanceDetailModel.proposal.id);});
for(const id of ['native-refresh','participation-refresh','resource-refresh'])$(id).addEventListener('click', nativeStatus);
$('history-refresh').addEventListener('click', refreshHistory);
$('history-form').addEventListener('submit', event => { event.preventDefault(); return openHistorical($('receipt-id').value.trim()); });
$('history-prev').addEventListener('click', () => { if (paired && historyPage > 0) { historyPage--; renderHistoryPage(); } });
$('history-next').addEventListener('click', () => { if (paired && (historyPage + 1) * PAGE_SIZE < receiptRows.filter(row=>historyFilter==='all'||historyFilter==='verified'&&row.reportedLevel!=='RPC_ONLY'||row.reportedLevel===historyFilter).length) { historyPage++; renderHistoryPage(); } });
if(typeof window!=='undefined')window.NetworkClient=Object.freeze({setHistoryFilter(value){if(!['all','RPC_ONLY','verified'].includes(value))return;historyFilter=value;historyPage=0;renderHistoryPage();},rerenderLocale(){for(const [el,render]of textBindings)el.textContent=render();renderHistoryPage();renderGovernance();}});
invalidateEvidence();
renderProofSetupGuide();
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
  const entries=new Map(), attempted=new Set(), uncertain=new Map(), unresolved=new Map(), knownRequests=new Set(), identityFences=new Map();
  let participationCheck=null, participationSelection=0;
  let preparingRequest=null, recoveredDifference=false, partCode=null, resourceCapabilityCode=null, nodeObservationPhase=null, resourceObservationPhase=null, nodeStartCancellationNotice=null;
  let resourceObservationSequence=0, resourceStopped=false, resourceSourceStatus=null;
  let resourceHistorySequence=0, resourceHistoryCode=null, resourceHistoryCursor='', resourceHistoryEntry=null;
  let resourceHistoryOwnerUnavailable=false;
  const resourceHistoryRows=new Map();
  const nodeKeys=['install','start','stop','restart','visibleConsent','read','logs'];
  const partKeys=['prepare','read','review','cancel','reconcile','submit','revoke','list'];
  const resourceKeys=['read','meter','stop','review','cancelReview','productionDispatch'];
  const bridge=()=>window.NetworkNative;
  const ready=()=>bridge()?.available===true&&bridge()?.ready===true;
  const pendingNodeStart=()=>ready()&&busy?.generation===generation&&busy?.channel==='node'&&busy?.effect===true&&busy?.operation==='node_start';
  const canCancelNodeStart=()=>pendingNodeStart()&&busy.cancelStartAttempted!==true&&bridge()?.canCancelNodeStart===true&&typeof bridge()?.cancelPendingNodeStart==='function';
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const ref=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
  const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
  const chainRecordID=v=>typeof v==='string'&&/^[a-f0-9]{24}$/.test(v);
  const participationID=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
  function caps(value,keys){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>typeof value[k]!=='boolean'))return {};return {...value};}
  const raw=(id,value)=>text(id,value===undefined||value===null?'—':String(value));
  const original=(id,value)=>raw(id,value?JSON.stringify(value,null,2):null);
  const nodeStageKey=stage=>({not_installed:'尚未安装',installed:'已安装',installing:'正在安装',starting:'正在启动',running:'运行中',stopping:'正在停止',stopped:'已停止',exited:'进程已退出',reconcile_required:'需核对原运行'})[stage]||'不可用';
  const candidateMissing='未提供候选安装包';
  const candidateUnavailable='安装包检查不可用';
  const candidateChecked='已核对候选文件字节；尚未获得发布授权。';
  const hexDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  function candidateURL(value){
    if(typeof value!=='string'||!/^[!-~]{1,512}$/.test(value)||/[?#\\]/.test(value))return false;
    try{
      const url=new URL(value);
      return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password;
    }catch{return false;}
  }
  function checkedNodeCandidate(value){
    if(!object(value)||value.code!=='PUBLIC_BYTES_CHECKED_NO_AUTHORITY'||
       value.authority!==false||value.originalReleaseAdmitted!==false||!hexDigest(value.manifestSHA256))return null;
    const m=value.manifest,n=m?.network;
    if(!object(m)||m.version!=='YNX-NETWORK-ORDINARY-RUNTIME-INTAKE/v1'||m.role!=='ordinary-observer'||
       m.managedFilename!=='node'||!['darwin','linux'].includes(m.os)||!['arm64','amd64'].includes(m.arch)||
       [m.blockProduction,m.validator,m.signer,m.validatorKeys].some(flag=>flag!==false)||
       typeof m.releaseVersion!=='string'||!/^[A-Za-z0-9](?:[A-Za-z0-9.+-]{0,62}[A-Za-z0-9])?$/.test(m.releaseVersion)||
       !uint(m.artifactBytes)||m.artifactBytes==='0'||BigInt(m.artifactBytes)>67108864n||
       !hexDigest(m.artifactSHA256)||!hexDigest(m.originalManifestSHA256)||!hexDigest(m.runtimeContractSHA256)||
       typeof m.sourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(m.sourceRevision)||!candidateURL(m.sourceRepository)||!candidateURL(m.artifactSource)||
       !object(n)||!hexDigest(n.networkId32)||!hexDigest(n.nativeGenesisSHA256)||!hexDigest(n.cometGenesisSHA256)||
       !uint(n.nativeChainId)||n.nativeChainId==='0'||typeof n.cometChainId!=='string'||!/^[!-~]{1,128}$/.test(n.cometChainId))return null;
    return {source:m.artifactSource,version:m.releaseVersion,bytes:m.artifactBytes+' B',network:n.networkId32,chain:n.nativeChainId+' / '+n.cometChainId};
  }
  function nodeCandidateLabel(candidate){
    if(!ready())return '尚未读取';
    if(candidate)return candidateChecked;
    if(node){
      const value=node.runtimeCandidate;
      return value===undefined||value?.code==='NOT_SUPPLIED'&&value.authority===false&&value.originalReleaseAdmitted===false
        ?candidateMissing:candidateUnavailable;
    }
    if(nodeObservationPhase==='loading')return '正在读取';
    return !nodeObservationPhase||nodeObservationPhase==='idle'?'尚未读取':candidateUnavailable;
  }
  function renderNodeCandidate(candidate){
    text('native-node-package-state',nodeCandidateLabel(candidate));
    for(const field of ['source','version','bytes','network','chain']){
      raw('native-node-package-'+field,candidate?.[field]);
      $('native-node-package-'+field+'-row').hidden=!candidate;
    }
  }
  let syncTimer=null, syncSequence=0, nodeArtifactRevision=0, nodeEffectReview=null;
  const reviewOriginalNode='原结果未确定。先读取原状态，不要重复操作。';
  const nodeConfirmationUnavailable='原生确认不可用。请重新打开已安装的 Network App，然后检查节点。';
  const nodeManagementNotSupplied='本机服务未提供普通节点管理。';
  const nodeOperationCopy=Object.freeze({
    CONSENT_UNAVAILABLE:nodeConfirmationUnavailable,
    NOT_SUPPLIED:nodeManagementNotSupplied,
    NOT_RUNNING:'当前没有可操作的受管运行。请重新检查节点状态。',
    BUSY:'请等待当前操作结束。',
    RECONCILING:reviewOriginalNode,
  });
  function nodeRetryBlocked(action){
    if(nodeObservationPhase==='RECONCILING'||nodeObservationPhase==='UNKNOWN'||node?.stage==='reconcile_required'||
       node?.diagnostics?.recovery?.priorEffectUnknown===true)return true;
    if(!nodeEffectReview)return false;
    // After an explicit valid owned status read, an uncertain restart still
    // must not be repeated. A new native Stop targets the observed run.
    if(nodeEffectReview.action==='restart'&&nodeEffectReview.originalRun){
      return action!=='stop'||nodeEffectReview.stopReady!==true;
    }
    if(nodeEffectReview.code!=='CAPACITY_LIMIT')return true;
    if(nodeEffectReview.action===action)return true;
    return action==='restart'&&(nodeEffectReview.action==='start'||nodeEffectReview.action==='stop')||
      action==='start'&&nodeEffectReview.action==='restart';
  }
  function nodeRunStatus(selfNode){
    const observed=nodeObservationPhase===null?selfNode:node;
    if(!observed){
      const phase=nodeObservationPhase;
      return phase==='loading'?'正在读取':phase==='NOT_SUPPLIED'?'当前接口未提供':!phase||phase==='idle'?'尚未读取':'不可用';
    }
    if(observed.code==='UNAVAILABLE')return '不可用';
    if(observed.code==='NOT_SUPPLIED')return '当前接口未提供';
    if(observed.stage==='running'){
      if(observed.processOwned!==true)return '结果未确定。';
      return observed.mode==='isolated-lifecycle-fixture'?'隔离节点运行中':observed.mode==='production'?'运行中':'结果未确定。';
    }
    if(['not_installed','installed','stopped','exited'].includes(observed.stage)&&observed.processOwned===false)return nodeStageKey(observed.stage);
    if(['installing','starting','stopping','reconcile_required'].includes(observed.stage))return nodeStageKey(observed.stage);
    return '结果未确定。';
  }
  function nodeWizardNext(installReady,candidate){
    if(bridge()?.available!==true)return '需要 Network 原生 App';
    if(!ready())return '原生连接尚未就绪';
    if(busy?.channel==='node'&&busy.effect===true&&busy.operation!=='node_status')return '等待原生确认；网页不能批准。';
    if(nodeObservationPhase==='loading')return '正在读取';
    if(nodeObservationPhase==='RECONCILING'||nodeObservationPhase==='UNKNOWN'||
       node?.stage==='reconcile_required'||node?.diagnostics?.recovery?.priorEffectUnknown===true||
       nodeEffectReview&&nodeEffectReview.code!=='CAPACITY_LIMIT')return reviewOriginalNode;
    if(nodeObservationPhase==='CAPACITY_LIMIT'||nodeEffectReview?.code==='CAPACITY_LIMIT')return nodeCapacityMessage;
    if(nodeObservationPhase==='NOT_SUPPLIED')return nodeManagementNotSupplied;
    if(!node)return '先检查此设备的节点状态。';
    if(nodeIntent)return '核对本次操作，再在原生窗口中确认。';
    if(node.stage==='reconcile_required'||node.stage==='running'&&node.processOwned!==true)return '原结果未确定。先读取原状态，不要重复操作。';
    if(node.stage==='running')return '可在下方查看本机同步与日志。';
    if(node.mode==='production'&&node.productionSupported!==true&&node.stage==='not_installed')return nodeCandidateLabel(candidate)===candidateMissing
      ?'尚未提供签名的普通节点安装包。请在包含安装包的 Network 版本中重新检查。'
      :candidate?'签名发布可用后，请重新检查节点。':'安装包检查不可用，请重新检查节点。';
    if(node.mode==='production'&&node.productionSupported===true&&nodeCaps.visibleConsent!==true)return nodeConfirmationUnavailable;
    if(installReady)return '输入发布方提供的摘要，再准备安装。';
    if(nodeCaps.start===true&&nodeCaps.visibleConsent===true)return '准备启动';
    return '先检查此设备的节点状态。';
  }
  function nodeCapacityReadings(status){
    const capacity=status?.capacity;
    if(!object(capacity)||capacity.complete!==true||
       !['usedBytes','limitBytes','freeBytes'].every(key=>uint(capacity[key]))||
       capacity.limitBytes==='0')return null;
    return capacity;
  }
  function renderNodeCapacity(){
    const capacity=ready()&&nodeObservationPhase==='CAPACITY_LIMIT'?nodeCapacityReadings(node):null;
    $('native-node-capacity-details').hidden=!capacity;
    for(const field of ['used','limit','free']){
      raw('native-node-capacity-'+field,capacity?capacity[field+'Bytes']+' B':null);
    }
  }
  function showSynchronization(value,context,emptyKey='尚未读取'){
    if(syncTimer!==null)clearTimeout(syncTimer);syncTimer=null;const sequence=++syncSequence;
    const binding=object(context)?{mode:context.mode,stage:context.stage,processOwned:context.processOwned,
      runId:Object.hasOwn(context,'runId')?context.runId:context.diagnostics?.logs?.runId}:null;
    if(binding&&Object.hasOwn(context,'generation'))binding.generation=context.generation;
    const sample=window.NetworkOverview?.synchronization?.(value,binding)||null;
    const labels={ISOLATED_PROCESS_REPORTED:'本机隔离进程报告',NOT_SUPPLIED:'当前接口未提供',NOT_RUNNING:'本机节点未运行',EXPIRED:'同步观测已过期',UNAVAILABLE:'同步观测不可用'};
    text('local-node-sync',sample?labels[sample.code]||'同步观测不可用':emptyKey);
    raw('local-node-sync-code',sample?.code);
    for(const [name,key]of [['height','localHeight'],['target','targetHeight'],['peers','peerCount'],['source','source'],['updated','updatedAt'],['expires','expiresAt'],['run','runId'],['generation','generation']])raw('local-node-sync-'+name,sample?.[key]);
    text('local-node-sync-catching',sample?.catchingUp===true?'进程报告仍在追赶':sample?.catchingUp===false?'进程报告未在追赶':'—');
    original('local-node-sync-original',sample);
    // A local timer only expires this read-only observation. It never refreshes
    // a request or changes node capabilities, approval or process ownership.
    if(sample?.code==='ISOLATED_PROCESS_REPORTED')syncTimer=setTimeout(()=>{
      if(sequence===syncSequence)showSynchronization(sample,binding,'同步观测不可用');
    },Math.max(1,Math.min(3000,Date.parse(sample.expiresAt)-Date.now())));
  }
  function state(id,code){
    const copy=id==='native-node-operation'&&Object.hasOwn(nodeOperationCopy,code)?nodeOperationCopy[code]:statusKey(code);
    text(id,()=>tr(copy)+(code==='UNKNOWN'?' · '+tr(reviewOriginalNode):''));
    if($(id+'-code'))raw(id+'-code',code);
  }
  function disabled(id,enabled){$(id).disabled=!ready()||!!busy||!enabled;}
  function authority(value,field){if(!object(value)||value[field]!==false||typeof value.code!=='string'||!/^([A-Z][A-Z_]{0,63})$/.test(value.code))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID',outcome:'UNKNOWN'});}
  async function request(operation,payload={}){
    if(busy?.channel==='node'&&busy.effect===true)busy.operation=operation;
    const pending=bridge().request(operation,payload);
    // The fixed bridge records its one pending request synchronously. This
    // render exposes only its negative cancellation signal; the original
    // Promise, global busy guard and Native Wait still own the outcome.
    if(operation==='node_start')render();
    const response=await pending;
    if(response?.version!=='YNX-NETWORK-LOCAL-IPC/v1'||response.code!=='OK'||response.peer?.nativeIPCVerified!==true||response.peer?.browserIdentityVerified!==false||!Number.isSafeInteger(response.peer?.uid)||response.peer.uid<0||response.peer.uid>4294967295||!object(response.result))throw Object.assign(new Error(response?.code||'NATIVE_RESPONSE_INVALID'),{code:response?.code||'NATIVE_RESPONSE_INVALID',outcome:'UNKNOWN'});
    return response.result;
  }
  async function run(channel,task,effect=false){
    if(!ready()){state('native-'+channel+'-operation','NATIVE_REQUIRED');render();return;}
    if(busy){state('native-'+channel+'-operation','NATIVE_BUSY');return;}
    const op={generation,channel,effect,partRead:channel==='part'&&partCaps.read===true};busy=op;if(channel==='part')participationCheck=null;if($('native-'+channel+'-operation-code'))raw('native-'+channel+'-operation-code',null);text('native-'+channel+'-operation',effect?(channel==='node'?'等待原生确认；网页不能批准。':channel==='part'?'交由 Wallet 审阅':'正在释放本机资源'):'正在读取');render();
    try{await task(()=>generation===op.generation&&busy===op&&ready(),op);}
    catch(error){if(op.generation===generation&&(op.resourceRead===undefined||op.resourceRead===resourceObservationSequence)){if(channel==='node'){nodeCaps={};nodeIntent=null;}if(channel==='part'){partCaps=error?.keepOriginalRead===true&&op.partRead?{read:true}:{};review=null;}if(channel==='resource'){resourceCaps={};resource=null;resourceStopped=false;resourceCapabilityCode=error?.code||'NATIVE_UNAVAILABLE';resourceObservationPhase=resourceCapabilityCode;raw('native-resource-original',null);$('native-resource-material').open=false;}const code=error?.outcome==='UNKNOWN'||effect&&error?.outcome!=='NOT_SENT'?'UNKNOWN':error?.code||'NATIVE_UNAVAILABLE';if(channel==='part'&&effect&&code==='UNKNOWN')rememberUncertainParticipation(op.originalEntry||entry);state('native-'+channel+'-operation',code);if(effect&&code==='UNKNOWN'){nodeIntent=null;if(channel==='node')nodeCaps={};if(channel==='resource')resourceCaps={};review=null;}}}
    finally{if(busy===op)busy=null;render();}
  }
  function nodeStatus(value){
    authority(value,'productionGrant');
    const limited=value.code==='CAPACITY_LIMIT';
    nodeObservationPhase=value.code;
    // Capacity can expose only the native helper's narrowly scoped stop path.
    // Validate the complete observation before honoring even this capability.
    nodeCaps=limited?{}:caps(value.capabilities,nodeKeys);
    node=null;
    if((value.code!=='OK'&&!limited)||!object(value.node))return value.code;
    const n=value.node;
    if(n.nodeId!=='ordinary-node'||typeof n.productionSupported!=='boolean'||typeof n.processOwned!=='boolean'||!uint(n.generation)||
       !['production','isolated-lifecycle-fixture'].includes(n.mode)||!ref(n.stage)||typeof n.artifactSHA256!=='string')
      throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
    if(limited&&!nodeCapacityReadings(n))return value.code;
    if(limited){
      const reported=caps(value.capabilities,nodeKeys);
      if(reported.read===true&&reported.stop===true&&reported.visibleConsent===true&&
         ['install','start','restart','logs'].every(key=>reported[key]===false)&&
         n.stage==='running'&&n.processOwned===true&&nodeRunID(n.runId)&&hexDigest(n.artifactSHA256)&&
         n.diagnostics?.recovery?.priorEffectUnknown!==true){
        nodeCaps=reported;
      }
    }
    node=n;nodeStartCancellationNotice=null;return value.code;
  }
  function clearNodeObservation(phase){
    nodeIntent=null;node=null;nodeCaps={};nodeObservationPhase=phase;
  }
  async function readNodeStatus(current){
    const value=(await request('node_status',{})).payload;
    if(current())return nodeStatus(value);
  }
  const nodeRunID=value=>typeof value==='string'&&/^[a-f0-9]{48}$/.test(value);
  function sameRestartRuntime(before,after){
    return nodeRunID(before?.runId)&&nodeRunID(after?.runId)&&
      uint(before.generation)&&uint(after.generation)&&BigInt(after.generation)>=BigInt(before.generation)&&
      hexDigest(before.artifactSHA256)&&before.artifactSHA256===after.artifactSHA256&&before.mode===after.mode&&
      after.stage==='running'&&after.processOwned===true&&after.diagnostics?.recovery?.priorEffectUnknown!==true;
  }
  function matchesRestartRun(before,after){
    return sameRestartRuntime(before,after)&&before.runId!==after.runId&&before.generation!==after.generation;
  }
  function matchesInstalledArtifact(expected,status){
    return hexDigest(expected?.artifactSHA256)&&
      expected.artifactSHA256===status?.artifactSHA256&&uint(expected.generation)&&uint(status.generation)&&
      BigInt(status.generation)>BigInt(expected.generation)&&
      status.stage==='installed'&&status.processOwned===false&&status.runId===''&&
      status.mode===expected.mode&&status.productionSupported===true&&
      status.diagnostics?.recovery?.priorEffectUnknown!==true;
  }
  async function applyNodeEffect(current,action,payload){
    const originalRun=action==='restart'&&node?{
      runId:node.runId,generation:node.generation,artifactSHA256:node.artifactSHA256,mode:node.mode,
    }:null;
    const expectedInstall=action==='install'?{
      artifactSHA256:payload.artifactSHA256,generation:payload.generation,mode:node?.mode,
    }:null;
    let code;
    try{
      const value=(await request('node_'+action,payload)).payload;
      if(!current())return;
      authority(value,'productionGrant');
      code=value.code;
    }catch(error){
      if(error?.outcome==='NOT_SENT')throw error;
      if(!current())return;
      code='UNKNOWN';
    }
    const restartAcknowledged=action==='restart'&&code==='OK';
    const installAcknowledged=action==='install'&&code==='OK';
    const installUncertain=action==='install'&&(code==='UNKNOWN'||code==='RECONCILING');
    if(restartAcknowledged||installAcknowledged)text('native-node-operation','正在读取');
    else state('native-node-operation',code);
    nodeCaps={};
    if(['UNKNOWN','RECONCILING','CAPACITY_LIMIT'].includes(code)){
      nodeEffectReview={code,action,
        originalRun:code!=='CAPACITY_LIMIT'&&nodeRunID(originalRun?.runId)?originalRun:null,
        expectedInstall:installUncertain?expectedInstall:null};
    }
    // The pending-Start cancellation control requires an explicit read after
    // the original native call settles. A dismissed approval prompt can use
    // the ordinary readback without asking for approval or sending an effect.
    if(code==='CANCELLED'&&action==='start'&&busy?.cancelStartAttempted===true)return;
    const cancellationNotice=nodeStartCancellationNotice;
    clearNodeObservation('loading');render();
    let confirmed=false;
    try{
      const observed=await readNodeStatus(current);
      confirmed=observed==='OK'&&(restartAcknowledged&&matchesRestartRun(originalRun,node)||
        (installAcknowledged||installUncertain)&&nodeCaps.read===true&&matchesInstalledArtifact(expectedInstall,node));
    }catch(error){
      if(current())clearNodeObservation(error?.code||'NATIVE_UNAVAILABLE');
    }finally{
      if(current()){
        nodeStartCancellationNotice=cancellationNotice;
        if(restartAcknowledged||installAcknowledged){
          if(confirmed)state('native-node-operation','OK');
          else {
            nodeEffectReview={code:'RECONCILING',action,originalRun,expectedInstall};
            clearNodeObservation('RECONCILING');
            state('native-node-operation','RECONCILING');
          }
        }
        if(installUncertain&&!confirmed)clearNodeObservation(code);
        if(action==='restart'&&(code==='UNKNOWN'||code==='RECONCILING')&&
           nodeEffectReview?.originalRun&&node?.stage==='running'&&!matchesRestartRun(originalRun,node)){
          clearNodeObservation(code);
        }
      }
    }
  }
  function acceptEntry(value,select=true){if(!object(value)||!participationID(value.id)||!object(value.intent)||!object(value.intent.request)||!['delegate','unbond','withdraw','vote'].includes(value.intent.request.action)||!ref(value.state))throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});entries.set(value.id,{id:value.id,requestId:value.intent.request.requestId,action:value.intent.request.action,state:value.state,createdAt:value.createdAt,updatedAt:value.updatedAt});if(select){entry=value;review=null;recoveredDifference=false;$('native-part-id').value=value.id;}return value;}
  // Key order is not authority: compare the complete original intent and
  // immutable journal identity semantically before adopting an action reply.
  function sameJSON(a,b){
    if(a===b)return true;
    if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameJSON(v,b[i]));
    if(!object(a)||!object(b))return false;
    const keys=Object.keys(a).sort(),other=Object.keys(b).sort();
    return keys.length===other.length&&keys.every((key,i)=>key===other[i]&&sameJSON(a[key],b[key]));
  }
  function sameParticipationIdentity(original,candidate){
    return object(original)&&object(candidate)&&original.id===candidate.id&&sameJSON(original.intent,candidate.intent)&&
      ['binding','businessBinding','slot','guard'].every(key=>!Object.hasOwn(original,key)||sameJSON(original[key],candidate[key]));
  }
  function assertParticipationIdentity(original,candidate){
    if(sameParticipationIdentity(original,candidate))return;
    if(original?.id&&!identityFences.has(original.id))identityFences.set(original.id,JSON.parse(JSON.stringify(original)));
    throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID',keepOriginalRead:true});
  }
  function rememberUncertainParticipation(original){
    if(original&&!uncertain.has(original.id))uncertain.set(original.id,original.binding);
  }
  function acceptParticipationReadback(value,id,canOfferProof,previous){
    const result=value.entry;
    if(result.id!==id)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
    const outcome={RPC_REPORTED_COMMITTED:'committed',RPC_REPORTED_REJECTED:'rejected',DENIED:'denied'};
    const resolvesUncertainty=value.code==='OK'&&value.authority===false&&uncertain.has(id)&&Object.hasOwn(outcome,result.state);
    if(resolvesUncertainty){
      const binding=historyBinding(result.binding),original=historyBinding(uncertain.get(id));
      const wallet=result.walletResult,observed=result.observation,status=outcome[result.state];
      const sameBinding=other=>Object.keys(binding).every(key=>binding[key]===other[key]);
      const bound=sameBinding(original)&&wallet?.operationId===id&&sameBinding(historyBinding(wallet.intent));
      receiptTimestamp(result.publishAttemptedAt);
      if(!bound|| (status==='denied'
        ?wallet.state!=='denied'||wallet.nativeHash!==undefined&&wallet.nativeHash!==''||observed!=null
        :!['pending','submitted','unknown','not_found'].includes(wallet.state)||typeof wallet.nativeHash!=='string'||!/^0x[a-f0-9]{64}$/.test(wallet.nativeHash)||
          observed?.nativeHash!==wallet.nativeHash||observed?.status!==status||observed.source!=='comet-rpc'||observed.independentFinality!==false)){
        throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
      }
    }
    acceptEntry(result);
    if(resolvesUncertainty)uncertain.delete(id); // The original send fence stays in attempted.
    if(canOfferProof)rememberParticipationCheck(value,id,previous);
  }
  function rememberParticipationCheck(value,id,previous){
    if(value.code!=='OK'||value.authority!==false||value.walletApproval!==false||uncertain.has(id))return;
    const result=value.entry,wallet=result.walletResult,observed=result.observation;
    const status=result.state==='RPC_REPORTED_COMMITTED'?'committed':result.state==='RPC_REPORTED_REJECTED'?'rejected':null;
    const kind={delegate:'stake_delegate',unbond:'stake_unbond',withdraw:'stake_withdraw'}[result.intent.request.action];
    const hash=v=>typeof v==='string'&&/^0x[a-f0-9]{64}$/.test(v);
    if(!status||!kind||result.intent.actionKind!==kind||wallet?.operationId!==id||
       !['pending','submitted','unknown','not_found'].includes(wallet.state)||!hash(wallet.nativeHash)||
       observed?.source!=='comet-rpc'||observed.status!==status||observed.nativeHash!==wallet.nativeHash||
       observed.independentFinality!==false||!hash(observed.abciHash)||!uint(observed.executionHeight)||observed.executionHeight==='0')return;
    try{
      const binding=historyBinding(result.binding);
      const same=other=>{const checked=historyBinding(other);return Object.keys(binding).every(key=>binding[key]===checked[key]);};
      if(!same(wallet.intent)||previous&&!same(previous.binding)||
         previous?.walletResult?.nativeHash&&previous.walletResult.nativeHash!==wallet.nativeHash)return;
      historyBinding(observed.wireBinding);
      historyBinding(observed.effectsBinding);
      receiptTimestamp(result.publishAttemptedAt);
    }catch{return;}
    participationCheck={entry:result,hash:observed.abciHash,generation,epoch,ticket,native:bridge()};
  }
  function canOfferParticipationCheck(id){
    const version=formVersion, selection=participationSelection, native=bridge();
    return ()=>version===formVersion&&selection===participationSelection&&native===bridge()&&$('native-part-id').value===id;
  }
  function participationCheckHash(){
    const check=participationCheck;
    if(!check||!paired||!ready()||!ticket||check.ticket!==ticket||check.epoch!==epoch||
       check.generation!==generation||check.native!==bridge()||check.entry!==entry||
       partCaps.read!==true||partCode!=='OK'||uncertain.has(entry.id)||$('native-part-id').value!==entry.id)return null;
    const expiry=sessionStorage.getItem('ynxNetworkTicketExpires');
    return !expiry||Date.parse(expiry)>Date.now()?check.hash:null;
  }
  const displayedParticipationState=value=>value&&uncertain.has(value.id)?'UNKNOWN':value?.state;
  function participation(value){authority(value,'walletApproval');partCode=value.code;partCaps=caps(value.capabilities,partKeys);if(value.authority!==undefined&&value.authority!==false)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});if(identityFences.size)partCaps={read:partCaps.read===true};return value.code;}
  function resourceStatus(value,stopReply=false){
    authority(value,'productionEnabled');
    resourceCaps=caps(value.capabilities,resourceKeys);
    if(resourceCaps.productionDispatch===true)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
    resourceCapabilityCode=resourceObservationPhase=value.code;
    resource=value;
    // Meter state belongs to the runner. Only a completed stop outcome also
    // accounts for release of the original Source.
    resourceStopped=stopReply&&resourceCaps.stop===false&&
      (value.code==='RETIRED_WITH_PRIOR_FAILURE'||value.code==='OK'&&value.meter===null);
    raw('native-resource-preview-bytes',null);raw('native-resource-preview-sha',null);
    original('native-resource-original',value);text('native-resource-code',statusKey(value.code));
    return value.code;
  }
  function clearResourceReading(){
    resource=null;resourceStopped=false;resourceCapabilityCode=null;
    for(const id of ['native-resource-original','native-resource-code','native-resource-preview-bytes','native-resource-preview-sha'])raw(id,null);
    $('native-resource-material').open=false;
  }
  function beginResourceRead(clearHistory=false){
    if(clearHistory)clearResourceHistory();clearResourceReading();resourceCaps={};resourceObservationPhase='loading';
    return ++resourceObservationSequence;
  }
  function beginResourceSelfRead(){
    if(!window.NetworkOverview?.project)return;
    clearResourceReading();
    if(busy?.resourceRead!==undefined){text('native-resource-operation','');raw('native-resource-operation-code',null);}
    resourceObservationPhase=null;
    return ++resourceObservationSequence;
  }
  function finishResourceSelfRead(sequence,value){
    if(sequence!==resourceObservationSequence)return;
    const report=window.NetworkOverview.project(null,value).native;
    if(report?.activity?.resource?.source&&!busy?.resourceStop)resourceSourceStatus=null;
    if(!report||report.activity?.resource?.code==='UNAVAILABLE'||report.resourceContribution==='unavailable'){
      resourceCapabilityCode='UNAVAILABLE';resourceCaps={...resourceCaps,read:false,meter:false};
      state('native-resource-operation','UNAVAILABLE');
    }
  }

  // These are historical public projections of the local journal. They never
  // create claims, execute work, verify a receipt or restore an authorization.
  const historyStates=['preparing','running','verifying','submitted','verified','historical','unknown','interrupted','stopped','failed'];
  const historyClasses=['CONTROLLED_SANDBOX','ORIGINAL_SOURCE_LOCAL_RECHECK_NOT_SERVICE'];
  const historyKindKeys={verify_chunk:'公开字节校验',public_block_histogram:'公开区块字节直方图',bounded_compute:'受限公开计算'};
  const historySummaryKeys=['id','kind','state','class','inputBytes','bytesRead','wallMicros','receiptId','verifiedAt','createdAt','updatedAt','failureRecorded','failureCode'];
  // Historical display data only. These codes neither change the stored state
  // nor permit a retry, contribution, reward or approval.
  const historyFailureKeys=Object.freeze({LIMIT:'任务已达到资源限制。',CANCELLED:'本机操作已取消。',DEADLINE:'任务超过允许执行时间。',STOPPED:'已停止',DENIED:'本次操作未获批准。',INVALID_REPORT:'本地结果未通过核对。',OS_LIMITS_UNAVAILABLE:'操作系统资源限制不可用。',PROCESS_INTERRUPTED:'上次运行已中断',UNKNOWN:'原记录包含失败或中断信息。'});
  const historyStateKeys={preparing:'准备中',running:'运行中',verifying:'正在核对',submitted:'已生成本地结果',verified:'本地结果已核对',historical:'已保存的本地记录',unknown:'结果未确定。',interrupted:'上次运行已中断',stopped:'已停止',failed:'本地任务失败'};
  function historyInvalid(){return Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID',outcome:'NOT_SENT'});}
  function historyExact(value,keys){if(!object(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw historyInvalid();}
  const historyTime=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
  const historyReceiptID=value=>typeof value==='string'&&value.length<=160&&/^[A-Za-z0-9_.:-]+$/.test(value);
  function historySummary(value,detail=false){
    if(!detail)historyExact(value,historySummaryKeys);
    if(!object(value)||!ref(value.id)||!['verify_chunk','public_block_histogram','bounded_compute'].includes(value.kind)||!historyStates.includes(value.state)||!historyClasses.includes(value.class)||!['inputBytes','bytesRead','wallMicros'].every(k=>uint(value[k]))||typeof value.failureRecorded!=='boolean'||!(value.failureCode===null||typeof value.failureCode==='string'&&Object.hasOwn(historyFailureKeys,value.failureCode))||value.failureRecorded!==(value.failureCode!==null)||value.createdAt!==null||value.updatedAt!==null||!(value.receiptId===null&&value.verifiedAt===null||historyReceiptID(value.receiptId)&&historyTime(value.verifiedAt)))throw historyInvalid();
    return Object.fromEntries(historySummaryKeys.map(k=>[k,value[k]]));
  }
  function historyBinding(value){historyExact(value,['bytes','sha3_512','sha512']);if(!uint(value.bytes)||!['sha3_512','sha512'].every(k=>typeof value[k]==='string'&&/^[a-f0-9]{128}$/.test(value[k])))throw historyInvalid();return {bytes:value.bytes,sha3_512:value.sha3_512,sha512:value.sha512};}
  function historyResult(value,id){historyExact(value,['job','manifest','input','output']);if(value.job!==id)throw historyInvalid();return {job:id,manifest:historyBinding(value.manifest),input:historyBinding(value.input),output:historyBinding(value.output)};}
  function historyDetail(value,id){
    historyExact(value,[...historySummaryKeys,'work','manifest','result','receipt']);
    const v=historySummary(value,true);if(v.id!==id)throw historyInvalid();
    historyExact(value.work,['job','kind','issuer','input','limits','expiresAt']);const w=value.work;
    historyExact(w.limits,['cpuMilli','memoryBytes','storageBytes','egressBytes','durationMillis']);
    if(w.job!==id||w.kind!==v.kind||!ref(w.issuer)||!historyTime(w.expiresAt)||!Object.values(w.limits).every(uint))throw historyInvalid();
    v.work={job:id,kind:w.kind,issuer:w.issuer,input:historyBinding(w.input),limits:{...w.limits},expiresAt:w.expiresAt};v.manifest=historyBinding(value.manifest);
    if(v.work.input.bytes!==v.inputBytes)throw historyInvalid();
    v.result=value.result===null?null:historyResult(value.result,id);v.receipt=null;
    if(value.receipt!==null){const r=value.receipt;historyExact(r,['id','job','class','result','verifiedBytes','verifiedAt']);if(r.id!==v.receiptId||r.job!==id||r.class!==v.class||!uint(r.verifiedBytes)||r.verifiedAt!==v.verifiedAt||!v.result)throw historyInvalid();v.receipt={id:r.id,job:id,class:r.class,result:historyResult(r.result,id),verifiedBytes:r.verifiedBytes,verifiedAt:r.verifiedAt};if(JSON.stringify(v.receipt.result)!==JSON.stringify(v.result))throw historyInvalid();}
    if((v.receiptId===null)!==(v.receipt===null)||v.result&&(JSON.stringify(v.result.manifest)!==JSON.stringify(v.manifest)||JSON.stringify(v.result.input)!==JSON.stringify(v.work.input)))throw historyInvalid();return v;
  }
  function historyEnvelope(value,kind){
    if(!object(value)||new TextEncoder().encode(JSON.stringify(value)).length>8192||value.historical!==true||value.authority!==false||value.productionEnabled!==false||value.rewards!=='NOT_AUTHORIZED'||!['OK','STALE','NOT_FOUND','NOT_SUPPLIED','UNAVAILABLE','INVALID'].includes(value.code))throw historyInvalid();
    const allowed=['code',kind==='list'?'entries':'entry','historical','authority','productionEnabled','rewards','capabilities',...(kind==='list'&&Object.hasOwn(value,'nextCursor')?['nextCursor']:[])];historyExact(value,allowed);
    const c=caps(value.capabilities,resourceKeys);if(Object.keys(c).length!==resourceKeys.length||c.productionDispatch!==false)throw historyInvalid();
    if(kind==='list'){if(!Array.isArray(value.entries)||value.entries.length>50||value.nextCursor!==undefined&&(typeof value.nextCursor!=='string'||new TextEncoder().encode(value.nextCursor).length>512||value.nextCursor.length===0))throw historyInvalid();if(value.code!=='OK'&&(value.entries.length||value.nextCursor))throw historyInvalid();}
    else if(value.code!=='OK'&&value.entry!==null||value.code==='OK'&&value.entry===null)throw historyInvalid();
    return value;
  }
  const canReadResourceHistory=()=>resourceCaps.read===true&&!resourceHistoryOwnerUnavailable;
  function clearResourceHistory(all=true){
    resourceHistorySequence++;resourceHistoryEntry=null;$('resource-history-detail').open=false;
    if(all){resourceHistoryRows.clear();resourceHistoryCursor='';}
    if(!resourceHistoryOwnerUnavailable){
      text('native-resource-history-operation','');raw('native-resource-history-operation-code',null);
      if(all)resourceHistoryCode=null;
    }
    renderResourceHistory();
  }
  function resourceHistoryOwnerLost(value){
    if(value.code!=='UNAVAILABLE')return false;
    // History readback has its own owner gate. Its refusal cannot replace
    // the independent Native capabilities for stopping work or cleanup.
    resourceHistoryOwnerUnavailable=true;
    resourceHistoryCode=value.code;
    state('native-resource-history-operation',value.code);
    clearResourceHistory();
    return true;
  }
  function renderResourceHistory(){
    const connected=ready(),readable=canReadResourceHistory();disabled('resource-history-refresh',readable);disabled('resource-history-next',readable&&!!resourceHistoryCursor);
    text('resource-history-notice',!connected?'请在 Network 原生 App 中操作。浏览器不具备本机操作入口。':'仅显示本机原任务记录；不恢复授权，不计为公网贡献或奖励。');
    text('resource-history-code',statusKey(!connected?'NATIVE_REQUIRED':resourceHistoryCode));if(!connected)raw('native-resource-history-operation-code','NATIVE_REQUIRED');
    text('resource-history-empty',resourceHistoryRows.size?'':resourceHistoryCode==='OK'?'本机尚无任务记录。':resourceHistoryCode==='STALE'?'记录已变化，请手动刷新列表。':resourceHistoryCode==='NOT_SUPPLIED'?'当前接口未提供':resourceHistoryCode==='NOT_FOUND'?'未找到原任务记录。':resourceHistoryCode===null?'尚未读取':'本机历史读取不可用。');
    const list=$('resource-history-records');list.replaceChildren();
    for(const row of resourceHistoryRows.values()){
      const button=document.createElement('button');button.type='button';button.className='resource-history-row';button.disabled=!connected||!!busy||!readable;button.setAttribute('aria-expanded',String(resourceHistoryEntry?.id===row.id));
      for(const [cls,value,literal]of [['resource-history-id',row.id,true],['resource-history-state',historyStateKeys[row.state],false],['resource-history-class',row.class==='CONTROLLED_SANDBOX'?'受控隔离测试':'原来源本地重检',false],['resource-history-time',row.verifiedAt||'—',true]]){const span=document.createElement('span');span.className=cls;span.textContent=literal?value:tr(value);if(literal)span.setAttribute('dir','ltr');if(cls==='resource-history-id'){const name=document.createElement('span');name.className='resource-history-kind';name.textContent=tr(historyKindKeys[row.kind]);name.setAttribute('dir','auto');span.append(name);}button.append(span);}
      button.addEventListener('click',()=>readResourceHistoryEntry(row.id));list.append(button);
    }
    const value=resourceHistoryEntry;$('resource-history-detail').hidden=!value;if(!value)$('resource-history-detail').open=false;
    for(const [key,data]of Object.entries({id:value?.id,kind:value?tr(historyKindKeys[value.kind]):null,state:value?tr(historyStateKeys[value.state]):null,class:value?(value.class==='CONTROLLED_SANDBOX'?tr('受控隔离测试'):tr('原来源本地重检')):null,input:value?.inputBytes,read:value?.bytesRead,wall:value?.wallMicros,receipt:value?.receiptId,verified:value?.verifiedAt,created:value?.createdAt,updated:value?.updatedAt}))raw('resource-history-'+key,data);
    text('resource-history-failure',value?value.failureCode===null?'原记录未记载失败。':historyFailureKeys[value.failureCode]:'—');
    original('resource-history-original',value?{...value,historical:true,authority:false,productionEnabled:false,rewards:'NOT_AUTHORIZED'}:null);
  }
  async function readResourceHistory(next=false){
    if(!ready()||!canReadResourceHistory()||busy)return;
    const token=resourceHistoryCursor;if(next&&!token)return;const sequence=++resourceHistorySequence;resourceHistoryEntry=null;resourceHistoryCode=null;if(!next){resourceHistoryRows.clear();resourceHistoryCursor='';}renderResourceHistory();
    return run('resource-history',async current=>{try{
      const value=historyEnvelope((await request('resource_list',next?{cursor:token,limit:20}:{limit:20})).payload,'list');if(!current()||sequence!==resourceHistorySequence)return;
      if(resourceHistoryOwnerLost(value))return;
      const rows=value.entries.map(row=>historySummary(row)),seen=new Set();for(const row of rows){if(seen.has(row.id)||next&&resourceHistoryRows.has(row.id))throw historyInvalid();seen.add(row.id);}
      if(value.code!=='OK'){resourceHistoryRows.clear();resourceHistoryCursor='';}else{if(!next)resourceHistoryRows.clear();for(const row of rows)resourceHistoryRows.set(row.id,row);resourceHistoryCursor=value.nextCursor||'';}
      resourceHistoryCode=value.code;state('native-resource-history-operation',value.code);
    }catch(error){if(current()&&sequence===resourceHistorySequence){resourceHistoryRows.clear();resourceHistoryCursor='';resourceHistoryEntry=null;resourceHistoryCode=error?.code||'NATIVE_UNAVAILABLE';state('native-resource-history-operation',resourceHistoryCode);}}});
  }
  async function readResourceHistoryEntry(id){
    if(!ready()||!canReadResourceHistory()||busy||!ref(id)||!resourceHistoryRows.has(id))return;
    const sequence=++resourceHistorySequence;resourceHistoryEntry=null;renderResourceHistory();
    return run('resource-history',async current=>{try{
      const value=historyEnvelope((await request('resource_get',{id})).payload,'get');if(!current()||sequence!==resourceHistorySequence)return;
      if(resourceHistoryOwnerLost(value))return;
      resourceHistoryEntry=value.code==='OK'?historyDetail(value.entry,id):null;resourceHistoryCode=value.code;state('native-resource-history-operation',value.code);if(resourceHistoryEntry)$('resource-history-detail').open=true;
    }catch(error){if(current()&&sequence===resourceHistorySequence){resourceHistoryEntry=null;resourceHistoryCode=error?.code||'NATIVE_UNAVAILABLE';state('native-resource-history-operation',resourceHistoryCode);}}});
  }

  async function list(current,next=false){
    const payload=next?{cursor,limit:20}:{limit:20};
    const invalid=()=>Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
    entry=null;review=null;recoveredDifference=false;partCaps={};partCode=null;
    if(!next){entries.clear();cursor='';}
    render();
    try{
      const result=(await request('participation_list',payload)).payload;
      if(!current())return;
      if(!object(result)||result.authority!==false)throw invalid();
      const {code,entries:rows,nextCursor}=result;
      const success=code==='OK';
      if(!Array.isArray(rows)||rows.length>50||!success&&rows.length||
         nextCursor!==undefined&&(!success||!rows.length||typeof nextCursor!=='string'||
           !nextCursor.length||new TextEncoder().encode(nextCursor).length>512))throw invalid();
      const page=new Map();
      for(const row of rows){
        if(!object(row)||!participationID(row.id)||page.has(row.id)||!ref(row.requestId)||
           !['delegate','unbond','withdraw','vote'].includes(row.action)||!ref(row.state))throw invalid();
        page.set(row.id,row);
      }
      participation(result);
      if(!success)entries.clear();
      for(const [id,row] of page)entries.set(id,row);
      cursor=nextCursor||'';
      state('native-part-operation',code);
    }catch(error){
      if(current()){entries.clear();cursor='';}
      throw error;
    }
  }
  async function load(channel='all'){
    if(!['all','node','resource','part'].includes(channel))return;
    const selected=channel==='all'?['node','resource','part']:[channel];
    return run(channel==='all'?'node':channel,async (current,op)=>{
      // An explicit read owns only the observation for that module. Native-session
      // bootstrap still reads all three in the original serialized order.
      if(selected.includes('node'))clearNodeObservation('loading');
      if(selected.includes('resource'))op.resourceRead=beginResourceRead(true);
      if(selected.includes('part')){review=null;entry=null;participationCheck=null;recoveredDifference=false;partCaps={};partCode=null;entries.clear();cursor='';}
      for(const kind of selected){text('native-'+kind+'-operation','正在读取');raw('native-'+kind+'-operation-code',null);}
      render();
      const read=async(kind,fn)=>{
        try{await fn();}catch(error){
          if(!current()||kind==='resource'&&op.resourceRead!==resourceObservationSequence)return;
          const code=error?.code||'NATIVE_UNAVAILABLE';
          const installOutcome=kind==='node'&&nodeEffectReview?.expectedInstall?nodeEffectReview.code:null;
          if(kind==='node')clearNodeObservation(installOutcome||code);
          if(kind==='part'){partCaps={};partCode=code;}
          if(kind==='resource'){resourceCaps={};resource=null;resourceCapabilityCode=code;resourceObservationPhase=code;}
          state('native-'+kind+'-operation',installOutcome||code);
        }
      };
      for(const kind of selected){
        if(!current())return;
        if(kind==='node')await read(kind,async()=>{
          const code=await readNodeStatus(current);
          if(!current())return;
          // A post-effect readback and native bootstrap update the observation.
          // Only a successful explicit check may clear an outstanding effect.
          const settled=node&&['not_installed','installed','running','stopped','exited'].includes(node.stage)&&
            node.processOwned===(node.stage==='running')&&node.diagnostics?.recovery?.priorEffectUnknown!==true;
          const review=nodeEffectReview;
          if(review?.originalRun)review.stopReady=false;
          if(review?.expectedInstall){
            if(code!=='OK'||nodeCaps.read!==true||!matchesInstalledArtifact(review.expectedInstall,node)){
              clearNodeObservation(review.code);
            }else if(channel==='node')nodeEffectReview=null;
          }else if(channel==='node'&&(code==='OK'||code==='CAPACITY_LIMIT'&&review?.code==='CAPACITY_LIMIT')&&nodeCaps.read===true&&settled){
            if(review?.originalRun&&node.stage==='running'&&!matchesRestartRun(review.originalRun,node)){
              review.stopReady=sameRestartRuntime(review.originalRun,node);
            }else nodeEffectReview=null;
          }
          // A status read may restore safe controls without recovering the
          // lost acknowledgment for the earlier effect.
          const effectOutcome=review&&(review.originalRun||review.expectedInstall)&&
            (review.code==='UNKNOWN'||nodeEffectReview===review)?review.code:null;
          state('native-node-operation',effectOutcome||code);
        });
        else if(kind==='resource'){
          // Bootstrap stages all three panels up front. A self-read may have
          // started while the earlier node request was pending. This actual
          // direct read starts now, without duplicating or skipping a module.
          if(op.resourceRead!==resourceObservationSequence){op.resourceRead=beginResourceRead();render();}
          await read(kind,async()=>{
            const value=(await request('resource_status',{})).payload;
            if(!current()||op.resourceRead!==resourceObservationSequence)return;
            state('native-resource-operation',resourceStatus(value));
            if(resourceHistoryOwnerUnavailable&&value.code==='OK'&&resourceCaps.read===true){
              resourceHistoryOwnerUnavailable=false;
              clearResourceHistory();
            }
          });
        }
        else await read(kind,()=>list(current,false));
        if(current())render();
      }
    });
  }

  function renderResourceCapabilities(){
    const available=bridge()?.available===true, connected=ready();
    const reading=resourceObservationPhase==='loading';
    const readable=(resourceCapabilityCode==='OK'||resourceStopped&&resourceCapabilityCode==='RETIRED_WITH_PRIOR_FAILURE')&&resourceCaps.read===true;
    const key=!available?'需要 Network 原生 App':!connected?'原生连接尚未就绪':reading?'正在读取':resourceCapabilityCode===null?'尚未读取':readable?'可查看设备状态与记录':'暂时无法查看设备状态。';
    text('resource-capabilities-local',key);
    raw('resource-capabilities-code',!available?'NATIVE_REQUIRED':!connected?'NATIVE_NOT_READY':resourceCapabilityCode);
    // The build contains fixed controlled algorithms. No feature observation,
    // read capability or historical receipt can open an execution control.
    text('resource-capabilities-compute','此设备暂未开放计算任务。');
    text('resource-capabilities-public','暂未开放；需要设备授权与服务接入。');
    text('resource-capabilities-rewards','尚未授权，当前不产生收益。');
    disabled('resource-capabilities-refresh',true);
    disabled('resource-capabilities-material',resource!==null);
  }
  async function readResourceCapabilities(){return load('resource');}

  function render(){
    renderResourceCapabilities();
    renderResourceHistory();
    renderNodeCapacity();
    if(resourceSourceStatus!==null)text('resource-source-state',resourceSourceStatus);
    const connected=ready(), note=connected?'能力只表示可尝试，仍须原生确认或 Wallet 批准。':'请在 Network 原生 App 中操作。浏览器不具备本机操作入口。';
    for(const channel of ['node','part','resource']){text('native-'+channel+'-notice',channel==='node'&&connected&&node?.mode==='production'&&node.productionSupported!==true?'正式节点安装仍须原发布方工件与独立可见批准。':channel==='part'&&connected&&partCode&&partCode!=='OK'?()=>tr(statusKey(partCode))+' · '+tr(partCode==='UNKNOWN'?'原结果未确定。先读取原状态，不要重复操作。':'能力只表示可尝试，仍须原生确认或 Wallet 批准。'):note);disabled('native-'+channel+'-read',true);}
    text('native-node-stage',node?nodeStageKey(node.stage):'—');text('native-node-mode',!node?'—':node.mode==='isolated-lifecycle-fixture'?'隔离生命周期测试模式':node.productionSupported?'正式节点模式':'正式节点模式（未开放）');raw('native-node-run',node?.runId||null);
    original('native-node-status-original',node?{node,productionGrant:false,capabilities:nodeCaps}:null);
    if(node){
      text('managed-node-state',nodeStageKey(node.stage));text('local-node-code',statusKey(node.productionSupported?'OK':'UNSUPPORTED'));raw('local-node-bytes',node.capacity?.complete===true&&uint(node.capacity.usedBytes)?node.capacity.usedBytes+' B':null);
      const diagnostic=object(node.diagnostics)&&node.diagnostics.authority===false?node.diagnostics:null;
      const logs=diagnostic?.logs;raw('local-node-logs-state',logs?.code);for(const stream of ['stdout','stderr']){const value=logs?.[stream]?.text;raw('local-node-'+stream,typeof value==='string'&&value.length<=16384?value:null);}
      text('local-node-recovery',diagnostic?.recovery?.priorEffectUnknown===true?'结果未确定。':node.processOwned?'本软件持有当前运行进程':'无运行任务');
    }else if(nodeObservationPhase!==null){
      // Once this native read owns the panel, a replacement request or failed
      // observation must not leave the previous stage, capacity or logs visible.
      // Before any native read, the separate HTTP self-status projection retains
      // its own read-only rendering path.
      const empty=nodeObservationPhase==='loading'?'正在读取':nodeObservationPhase==='idle'?'尚未读取':nodeObservationPhase==='NOT_SUPPLIED'?'当前接口未提供':nodeObservationPhase==='UNSUPPORTED'?'当前版本不支持此操作。':'不可用';
      text('managed-node-state',empty);text('local-node-recovery',empty);
      text('local-node-code',statusKey(['loading','idle'].includes(nodeObservationPhase)?null:nodeObservationPhase));
      for(const id of ['local-node-bytes','local-node-logs-state','local-node-stdout','local-node-stderr'])raw(id,null);
    }
    if(connected)showSynchronization(node?.diagnostics?.authority===false?node.diagnostics.synchronization:null,node,nodeObservationPhase==='loading'?'正在读取':nodeObservationPhase==='idle'?'尚未读取':'同步观测不可用');
    if(resourceObservationPhase!==null){
      const meter=resource?.code==='OK'||resourceStopped?resource?.meter:null;
      const count=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):uint(value)?value:null;
      const runnerStopped=meter?.state==='stopped';
      const stopped=resourceStopped||runnerStopped&&resourceCaps.stop===false;
      const running=meter?.class==='CONTROLLED_SANDBOX'&&meter.state==='running';
      const uncertain=resourceObservationPhase==='UNKNOWN'||runnerStopped&&!stopped;
      const empty=resourceObservationPhase==='loading'?'正在读取':resourceObservationPhase==='idle'?'尚未读取':uncertain?'结果未确定。':'不可用';
      text('resource-state',stopped?'已停止':meter?.state==='disabled'?'已关闭':running?'本机隔离测试中。':empty);
      text('resource-task-state',stopped||meter?.state==='disabled'?'无运行任务':running?'本机隔离测试中。':empty);
      text('resource-code',statusKey(!meter&&resourceCapabilityCode==='OK'?'UNAVAILABLE':resourceCapabilityCode));
      raw('resource-verified-jobs',count(meter?.verifiedJobs));raw('resource-verified-bytes',count(meter?.verifiedBytes)===null?null:count(meter.verifiedBytes)+' B');raw('resource-active-workers',count(meter?.activeWorkers));
    }
    const mode=node?.mode==='production'&&node.productionSupported===true;
    const installReady=mode&&nodeCaps.install===true&&nodeCaps.visibleConsent===true&&node.stage==='not_installed'&&!nodeRetryBlocked('install');
    const artifact=$('native-node-artifact');
    $('native-node-artifact-field').hidden=!installReady;
    artifact.disabled=!ready()||!installReady||busy?.effect===true;
    disabled('native-node-install',installReady&&/^[a-f0-9]{64}$/.test(artifact.value.trim()));
    const candidate=connected?checkedNodeCandidate(node?.runtimeCandidate):null;
    renderNodeCandidate(candidate);
    text('native-node-wizard-next',nodeWizardNext(installReady,candidate));
    if(nodeObservationPhase!==null){
      const card=$('dash-node-run');
      card.removeAttribute?.('data-i18n');
      card.textContent=tr(nodeRunStatus());
    }
    disabled('native-node-start',nodeCaps.start===true&&nodeCaps.visibleConsent===true&&mode&&['installed','stopped','exited'].includes(node?.stage)&&node?.processOwned===false&&!nodeRetryBlocked('start'));
    disabled('native-node-stop',nodeCaps.stop===true&&nodeCaps.visibleConsent===true&&node?.processOwned===true&&node?.stage==='running'&&!nodeRetryBlocked('stop'));
    disabled('native-node-restart',nodeCaps.restart===true&&nodeCaps.visibleConsent===true&&mode&&node?.processOwned===true&&node?.stage==='running'&&!nodeRetryBlocked('restart'));
    $('native-node-cancel-start').hidden=!pendingNodeStart()||!canCancelNodeStart()&&busy.cancelStartAttempted!==true;
    $('native-node-cancel-start').disabled=!canCancelNodeStart();
    $('native-node-cancel-start-note').hidden=!nodeStartCancellationNotice;text('native-node-cancel-start-note',nodeStartCancellationNotice||'');
    $('native-node-cancel-start-panel').hidden=$('native-node-cancel-start').hidden&&$('native-node-cancel-start-note').hidden;
    $('native-node-intent-panel').hidden=!nodeIntent;text('native-node-intent-action',nodeIntent?({install:'准备安装',start:'准备启动',stop:'准备停止'})[nodeIntent.action]:'');original('native-node-intent',nodeIntent);disabled('native-node-confirm',!!nodeIntent&&nodeCaps[nodeIntent.action]===true&&nodeCaps.visibleConsent===true&&!nodeRetryBlocked(nodeIntent.action));disabled('native-node-cancel',!!nodeIntent);
    const action=$('native-part-action').value||'delegate';$('native-part-amount-field').hidden=action==='withdraw'||action==='vote';$('native-part-amount').required=action!=='withdraw'&&action!=='vote';$('native-part-choice-field').hidden=action!=='vote';
    text('native-part-target-note',action==='delegate'?'填写原验证者标识。':action==='unbond'?'填写原委托标识。':action==='withdraw'?'填写原解押标识。':'填写原提案标识；不会在网页生成投票编码。');
    $('governance-use-proposal').disabled=!paired||!governanceDetailModel?.proposal||!canSelectProposal();
    disabled('native-part-prepare',partCaps.prepare===true&&unresolved.size===0&&!knownRequests.has($('native-part-request').value.trim()));$('native-part-draft').disabled=!!busy||unresolved.size>0||entry?.state==='UNKNOWN'||entry?.state==='AWAITING_WALLET';disabled('native-part-resolve',partCaps.read===true&&(unresolved.size>0||ref($('native-part-request').value.trim())));disabled('native-part-list',partCaps.list===true);disabled('native-part-next',partCaps.list===true&&!!cursor);disabled('native-part-get',partCaps.read===true);disabled('native-part-revoke',partCaps.revoke===true);
    $('native-part-entry-panel').hidden=!entry;raw('native-part-entry-id',entry?.id);text('native-part-entry-state',statusKey(displayedParticipationState(entry)));text('native-part-blocked',entry?.blockedReason||entry?.lastError?'本次请求未完成，请查看详细报告。':'');
    const reviewed=unresolved.size===0&&review&&review.entry?.id===entry?.id&&review.authority===false&&review.requiresWalletApproval===true&&review.walletAdapterConfigured===true&&review.originalEffectMayExist===false&&review.conditionStatus==='CURRENT_RPC_REPORTED';
    disabled('native-part-review',partCaps.review===true&&!!entry);disabled('native-part-cancel',partCaps.cancel===true&&!!entry);disabled('native-part-reconcile',partCaps.reconcile===true&&!!entry);disabled('native-part-submit',partCaps.submit===true&&entry?.state==='PREPARED'&&reviewed&&!entry.publishAttemptedAt&&!attempted.has(entry.id));
    const req=entry?.intent?.request;for(const [key,value]of Object.entries({action:req?tr(actionKey(req.action)):null,owner:req?.owner,target:req?.validator||req?.delegationId||req?.unbondingId||req?.proposal,amount:req?.amountYnxt,fee:req?.feeCapYnxt,expires:req?.expiresAt}))raw('native-part-original-'+key,value);
    $('native-part-recovery').hidden=unresolved.size===0&&!recoveredDifference;text('native-part-recovery',()=>unresolved.size?tr('原结果未确定。先读取原状态，不要重复操作。')+' '+[...unresolved.keys()].join(' · '):recoveredDifference?tr('查回的原请求内容与草稿不同；不会按草稿修改原请求。'):'');
    const check=participationCheckHash();
    $('native-part-open-proof').hidden=!check;
    disabled('native-part-open-proof',!!check);
    original('native-part-original',review||entry);
    const history=$('native-part-records');history.replaceChildren();for(const row of entries.values()){const button=document.createElement('button');button.type='button';button.className='native-entry-row';button.disabled=!connected||!!busy||partCaps.read!==true;button.textContent=[tr(actionKey(row.action)),tr(statusKey(displayedParticipationState(row))),row.requestId,row.id,row.updatedAt||row.createdAt||'—'].join(' · ');button.addEventListener('click',()=>get(row.id));history.append(button);}
    disabled('native-resource-meter',resourceCaps.meter===true);disabled('native-resource-stop',resourceCaps.stop===true);disabled('native-resource-review',resourceCaps.review===true);disabled('native-resource-cancel',resourceCaps.cancelReview===true);
  }
  function reset(){nodeStartCancellationNotice=null;nodeEffectReview=null;participationCheck=null;resourceObservationSequence++;resourceCapabilityCode=null;resourceStopped=false;resourceSourceStatus=null;if(resourceObservationPhase!==null)resourceObservationPhase='idle';$('native-resource-material').open=false;resourceHistoryOwnerUnavailable=false;clearResourceHistory();text('native-resource-history-operation','');partCode=null;recoveredDifference=false;if(preparingRequest)unresolved.set(preparingRequest.requestId,{request:preparingRequest});if(busy?.effect&&busy.channel==='part')rememberUncertainParticipation(busy.originalEntry||entry);generation++;busy=null;node=null;if(nodeObservationPhase!==null)nodeObservationPhase='idle';nodeCaps={};nodeIntent=null;partCaps={};resourceCaps={};resource=null;review=null;entry=null;cursor='';entries.clear();for(const id of ['native-node-operation','native-part-operation','native-resource-operation']){text(id,'');raw(id+'-code',null);}for(const id of ['native-resource-original','native-resource-code','native-resource-preview-bytes','native-resource-preview-sha'])raw(id,null);showSynchronization(null,null);render();}
  for(const id of ['native-node-read','native-part-read','native-resource-read'])$(id).addEventListener('click',()=>load(id.includes('resource')?'resource':id.includes('part')?'part':'node'));
  $('native-node-artifact').addEventListener('input',()=>{
    nodeArtifactRevision++;
    if(nodeIntent?.action==='install'){
      nodeIntent=null;
      state('native-node-operation','CANCELLED');
    }
    render();
  });
  for(const action of ['install','start','stop'])$('native-node-'+action).addEventListener('click',()=>{
    if($('native-node-'+action).disabled)return;
    const attempt=run('node',async current=>{
      if(nodeCaps[action]!==true||nodeCaps.visibleConsent!==true)throw Object.assign(new Error('UNSUPPORTED'),{code:'UNSUPPORTED',outcome:'NOT_SENT'});
      nodeIntent=null;
      const hash=action==='install'?$('native-node-artifact').value.trim():'';
      const revision=nodeArtifactRevision;
      if(action==='install'&&!/^[a-f0-9]{64}$/.test(hash))throw Object.assign(new Error('INVALID_ARTIFACT_SHA256'),{code:'INVALID_ARTIFACT_SHA256',outcome:'NOT_SENT'});
      const value=(await request('node_prepare',{action,artifactSHA256:hash})).payload;
      if(!current())return;
      if(action==='install'&&(revision!==nodeArtifactRevision||$('native-node-artifact').value.trim()!==hash)){
        state('native-node-operation','CANCELLED');
        return;
      }
      authority(value,'productionGrant');
      const intent=value.node;
      if(value.code==='PREPARED'&&object(intent)&&Object.keys(intent).length===5&&ref(intent.managerId)&&intent.nodeId==='ordinary-node'&&intent.action===action&&intent.generation===node?.generation&&intent.artifactSHA256===(hash||node?.artifactSHA256)){
        nodeIntent=intent;
      }else if(value.code==='PREPARED'){
        throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
      }
      state('native-node-operation',value.code);
    });
    return attempt.then(()=>{if(nodeIntent?.action===action&&!$('native-node-confirm').disabled)$('native-node-confirm').focus?.();});
  });
  $('native-node-cancel').addEventListener('click',()=>{nodeIntent=null;state('native-node-operation','CANCELLED');render();});
  $('native-node-cancel-start').addEventListener('click',()=>{
    if(!canCancelNodeStart())return;const op=busy;op.cancelStartAttempted=true;let sent=false;
    try{sent=bridge().cancelPendingNodeStart()===true;}catch{/* Delivery may already have happened; retain the original request. */}
    if(busy!==op||op.generation!==generation)return;
    nodeStartCancellationNotice=sent?'已请求取消启动；结束后请读取节点状态。':'未能确认取消请求；请等待原结果，再读取节点状态。';render();
  });
  $('native-node-confirm').addEventListener('click',()=>{const intent=nodeIntent;if(!intent||nodeRetryBlocked(intent.action)||nodeCaps[intent.action]!==true||nodeCaps.visibleConsent!==true||intent.action==='install'&&$('native-node-artifact').value.trim()!==intent.artifactSHA256)return;nodeIntent=null;return run('node',current=>applyNodeEffect(current,intent.action,intent),true);});
  $('native-node-restart').addEventListener('click',()=>{if($('native-node-restart').disabled||nodeCaps.restart!==true||nodeCaps.visibleConsent!==true||node?.processOwned!==true)return;nodeIntent=null;return run('node',current=>applyNodeEffect(current,'restart',{}),true);});
  function canSelectProposal(){return !busy&&unresolved.size===0&&!['UNKNOWN','AWAITING_WALLET'].includes(entry?.state);}
  function draftChanged(){formVersion++;participationCheck=null;review=null;entry=null;recoveredDifference=false;render();}
  for(const name of ['action','request','owner','target','amount','fee','expires','choice'])$('native-part-'+name).addEventListener(name==='action'||name==='choice'?'change':'input',draftChanged);
  $('native-part-draft').addEventListener('click',()=>{if(busy||unresolved.size)return;const bytes=new Uint8Array(16);if(!window.crypto?.getRandomValues){state('native-part-operation','LOCAL_ID_UNAVAILABLE');return;}window.crypto.getRandomValues(bytes);$('native-part-request').value='local-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');$('native-part-expires').value=new Date(Date.now()+5*60*1000).toISOString();draftChanged();});
  function requestForm(){const action=$('native-part-action').value||'delegate',req={requestId:$('native-part-request').value.trim(),owner:$('native-part-owner').value.trim(),action,feeCapYnxt:$('native-part-fee').value.trim(),expiresAt:$('native-part-expires').value.trim()},target=$('native-part-target').value.trim(),amount=$('native-part-amount').value.trim(),expiry=Date.parse(req.expiresAt);if(!ref(req.requestId)||!/^0x[a-f0-9]{40}$/.test(req.owner)||!uint(req.feeCapYnxt)||!Number.isFinite(expiry)||!req.expiresAt.endsWith('Z')||expiry<=Date.now()||expiry>Date.now()+10*60*1000)throw Object.assign(new Error('INVALID_REQUEST'),{code:'INVALID_REQUEST',outcome:'NOT_SENT'});if(action==='delegate'||action==='unbond'){if(!uint(amount)||BigInt(amount)===0n||BigInt(amount)>9223372036854775807n)throw Object.assign(new Error('INVALID_AMOUNT'),{code:'INVALID_AMOUNT',outcome:'NOT_SENT'});req.amountYnxt=amount;if(action==='delegate'&&ref(target))req.validator=target;else if(action==='unbond'&&chainRecordID(target))req.delegationId=target;else throw Object.assign(new Error('INVALID_TARGET'),{code:'INVALID_TARGET',outcome:'NOT_SENT'});}else if(action==='withdraw'&&chainRecordID(target))req.unbondingId=target;else if(action==='vote'&&ref(target)&&['yes','no','abstain'].includes($('native-part-choice').value)){req.proposal=target;req.choice=$('native-part-choice').value;}else throw Object.assign(new Error('INVALID_TARGET'),{code:'INVALID_TARGET',outcome:'NOT_SENT'});return req;}
  $('native-part-form').addEventListener('submit',event=>{event.preventDefault();if(partCaps.prepare!==true||$('native-part-prepare').disabled)return;const form=formVersion;run('part',async current=>{const req=requestForm();preparingRequest=req;try{const value=(await request('participation_prepare',req)).payload;if(!current())return;participation(value);if(value.entry){acceptEntry(value.entry,form===formVersion);knownRequests.add(req.requestId);}state('native-part-operation',value.code);}catch(error){if(error?.outcome==='NOT_SENT')unresolved.delete(req.requestId);else{unresolved.set(req.requestId,{request:req,cause:error?.code||'NATIVE_RESPONSE_INVALID'});throw Object.assign(new Error(error?.message||'NATIVE_RESPONSE_INVALID'),{code:error?.code||'NATIVE_RESPONSE_INVALID',outcome:'UNKNOWN'});}throw error;}finally{if(preparingRequest===req)preparingRequest=null;}});});
  async function get(id){
    if(!participationID(id)||partCaps.read!==true||busy)return;
    const previous=entry?.id===id?entry:null;
    $('native-part-id').value=id;
    const selectionCurrent=canOfferParticipationCheck(id);
    return run('part',async current=>{
      entry=null;review=null;recoveredDifference=false;
      const value=(await request('participation_get',{id})).payload;
      if(!current())return;
      participation(value);
      const fenced=identityFences.get(id);
      if(fenced&&value.code==='OK'&&!value.entry)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID',keepOriginalRead:true});
      if(fenced&&value.entry)assertParticipationIdentity(fenced,value.entry);
      if(value.entry)acceptParticipationReadback(value,id,selectionCurrent(),fenced||previous);
      // Only a successful native read of this exact original, with its full
      // immutable identity, can release this fence. Other IDs never do so.
      if(fenced&&value.code==='OK'&&value.authority===false&&value.entry){identityFences.delete(id);participation(value);}
      state('native-part-operation',value.code);
    });
  }
  $('native-part-id').addEventListener('input',()=>{participationSelection++;participationCheck=null;render();});
  $('native-part-open-proof').addEventListener('click',()=>{
    const hash=participationCheckHash();
    if(!busy&&hash)publish('participationProof',hash);
  });
  $('native-part-get-form').addEventListener('submit',event=>{event.preventDefault();get($('native-part-id').value.trim());});
  function requestShape(value){const keys=['requestId','owner','action','proposal','choice','validator','delegationId','unbondingId','amountYnxt','feeCapYnxt','expiresAt'];return object(value)&&Object.keys(value).every(k=>keys.includes(k))?JSON.stringify(keys.map(k=>value[k]??'')):null;}
  $('native-part-resolve').addEventListener('click',()=>{const id=unresolved.keys().next().value||$('native-part-request').value.trim();if(!ref(id)||partCaps.read!==true)return;run('part',async current=>{const pending=unresolved.get(id),value=(await request('participation_resolve',{requestId:id})).payload;if(!current())return;participation(value);if(value.authority!==false||value.resolvedRequestId!==id)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});knownRequests.add(id);if(value.code==='OK'&&value.entry){acceptEntry(value.entry);recoveredDifference=!!pending&&requestShape(value.entry.intent.request)!==requestShape(pending.request);unresolved.delete(id);}else{entry=null;review=null;}state('native-part-operation',unresolved.has(id)?'UNKNOWN':value.code);});});
  $('native-part-list').addEventListener('click',()=>run('part',current=>list(current,false)));
  $('native-part-next').addEventListener('click',()=>{if(cursor&&partCaps.list===true)run('part',current=>list(current,true));});
  for(const action of ['review','cancel','reconcile','submit'])$('native-part-'+action).addEventListener('click',()=>{const id=entry?.id;if(!id||partCaps[action]!==true||action==='submit'&&$('native-part-submit').disabled)return;if(busy)return;if(action==='submit')attempted.add(id);const selected=id,originalEntry=entry,selectionCurrent=canOfferParticipationCheck(id);run('part',async (current,op)=>{op.originalEntry=originalEntry;let value;try{value=(await request('participation_'+action,{id})).payload;}catch(error){if(action==='submit'&&error?.outcome==='NOT_SENT')attempted.delete(id);throw error;}if(!current())return;participation(value);if(value.entry){assertParticipationIdentity(originalEntry,value.entry);if(action==='reconcile')acceptParticipationReadback(value,id,selectionCurrent(),originalEntry);else acceptEntry(value.entry);}if(action==='review'&&value.review){const candidate=value.review; assertParticipationIdentity(originalEntry,candidate.entry);if(candidate.version!=='YNX-NETWORK-PARTICIPATION-REVIEW/v1'||candidate.authority!==false||candidate.requiresWalletApproval!==true||candidate.independentFinality!==false)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID',keepOriginalRead:true});review=candidate;acceptEntry(candidate.entry);review=candidate;}if(entry?.id!==selected)review=null;state('native-part-operation',value.code);},action==='submit');});
  $('native-part-revoke').addEventListener('click',()=>{if(partCaps.revoke!==true)return;run('part',async current=>{const value=(await request('participation_revoke',{})).payload;if(!current())return;participation(value);review=null;nodeIntent=null;state('native-part-operation',value.code);},true);});
  document.querySelectorAll('[data-participation-action]').forEach(button=>button.addEventListener('click',()=>{$('native-part-action').value=button.dataset.participationAction;if(button.dataset.participationChoice)$('native-part-choice').value=button.dataset.participationChoice;draftChanged();$('native-part-form').scrollIntoView?.({block:'start'});}));
  for(const action of ['meter','stop','review','cancel'])$('native-resource-'+action).addEventListener('click',()=>{const key=action==='cancel'?'cancelReview':action;if(resourceCaps[key]!==true)return;run('resource',async (current,op)=>{
    if(action==='meter'){op.resourceRead=beginResourceRead();render();}
    const previousSourceStatus=resourceSourceStatus;
    if(action==='stop'){
      op.resourceStop=true;
      resourceSourceStatus='正在释放本机资源';
      beginResourceRead();render();
    }
    raw('native-resource-preview-bytes',null);raw('native-resource-preview-sha',null);
    try {
      const value=(await request(action==='cancel'?'resource_review_cancel':'resource_'+action,{})).payload;
      if(!current())return;
      if(action==='review'||action==='cancel'){
        authority(value,'authority');if(value.productionEnabled!==false||value.consentProduced!==false)throw Object.assign(new Error('NATIVE_RESPONSE_INVALID'),{code:'NATIVE_RESPONSE_INVALID'});
        text('native-resource-code',statusKey(value.code));raw('native-resource-preview-bytes',uint(value.previewBytes)?value.previewBytes:null);raw('native-resource-preview-sha',typeof value.previewSHA256==='string'&&/^[a-f0-9]{64}$/.test(value.previewSHA256)?value.previewSHA256:null);original('native-resource-original',value);resourceCaps=caps(value.capabilities,resourceKeys);
      }else if(action==='stop'){
        // A self-check started during the stop may still have seen the
        // original Source active, even if its reply arrives after cleanup.
        resourceObservationSequence++;
        resourceStatus(value,true);
        resourceSourceStatus=resourceCaps.stop===false&&['OK','RETIRED_WITH_PRIOR_FAILURE'].includes(value.code)?'已停止':'结果未确定。';
      }else if(op.resourceRead===resourceObservationSequence)resourceStatus(value);
      else return;
      state('native-resource-operation',value.code);
    } catch(error) {
      if(action==='stop'&&current()){
        if(error?.outcome==='NOT_SENT')resourceSourceStatus=previousSourceStatus;
        else{resourceObservationSequence++;resourceSourceStatus='结果未确定。';}
      }
      throw error;
    }
  },action==='stop');});
  $('resource-capabilities-refresh').addEventListener('click',readResourceCapabilities);
  $('resource-capabilities-material').addEventListener('click',()=>{if($('resource-capabilities-material').disabled)return;$('native-resource-material').open=true;$('native-resource-original').scrollIntoView?.({block:'center'});$('native-resource-original').focus?.({preventScroll:true});});
  $('resource-history-refresh').addEventListener('click',()=>readResourceHistory(false));
  $('resource-history-next').addEventListener('click',()=>readResourceHistory(true));
  document.addEventListener('click',event=>{const route=event.target?.closest?.('[data-route]')?.dataset?.route;if(route&&route!=='contribution')clearResourceHistory(false);});
  window.addEventListener('hashchange',()=>clearResourceHistory(false));
  window.addEventListener('network:native-state',()=>{reset();if(ready())load();});
  window.addEventListener('pagehide',reset);
  window.NetworkOperations=Object.freeze({reset,refresh:load,rerenderLocale:render,beginResourceSelfRead,finishResourceSelfRead,hasDirectResourceObservation:()=>resourceObservationPhase!==null,hasResourceSourceStopStatus:()=>resourceSourceStatus!==null,clearResourceHistory,showSynchronization,nodeStageKey,nodeRunStatus,statusKey,canSelectProposal,selectProposal(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)||!canSelectProposal())return false;$('native-part-action').value='vote';$('native-part-target').value=id;draftChanged();$('native-part-form').scrollIntoView?.({block:'start'});return true;}});
  window.NetworkI18n?.subscribe(render);
  if(!$('native-part-action').value)$('native-part-action').value='delegate';
  render();if(ready())load();
})();
