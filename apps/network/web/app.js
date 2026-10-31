'use strict';
const $ = id => document.getElementById(id);
const levels = ['RPC_ONLY', 'HEADER_VERIFIED', 'INCLUSION_VERIFIED', 'STATE_VERIFIED'];
let ticket = sessionStorage.getItem('ynxNetworkTicket') || '';
let generation = 0;
const txKey = value => String(value || '').trim().toLowerCase().replace(/^0x/, '');
const controls = enabled => {
  $('lookup-button').disabled = !enabled;
  $('proof-file').disabled = !enabled;
  $('pair-form').hidden = enabled;
  $('revoke').hidden = !enabled;
};
function notice(text, error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('error', error);
}
function invalidateEvidence(message) {
  generation++;
  $('level-tag').textContent = '尚未查询';
  $('level-tag').className = 'tag neutral';
  document.querySelectorAll('.levels li').forEach((row, index) => {
    row.classList.remove('reached', 'reported');
    row.querySelector('.step-status').textContent = index === 0 ? '待查询' : index === 3 ? '等待状态证明' : '缺少证据';
  });
  $('evidence-meta').hidden = true;
  ['meta-tx', 'meta-level', 'meta-source', 'meta-height', 'meta-reason', 'raw-report'].forEach(id => { $(id).textContent = ''; });
  $('raw-panel').hidden = true;
  if (message) notice(message);
}
function clearPairing(message) {
  ticket = '';
  sessionStorage.removeItem('ynxNetworkTicket');
  controls(false);
  invalidateEvidence();
  $('pair-state').textContent = message;
  notice(message);
}
async function api(path, body = {}) {
  const sentTicket = ticket;
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(sentTicket ? { Authorization: 'Bearer ' + sentTicket } : {}) },
    body: JSON.stringify(body), cache: 'no-store', credentials: 'omit'
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && ticket === sentTicket) clearPairing('配对已过期或已撤销。重启本机 helper 后重新配对。');
    throw new Error(result.error || '请求未完成');
  }
  return result;
}
function startOperation() {
  invalidateEvidence('正在核对本次交易，尚无本次验证结论。');
  return { generation, txId: $('tx-id').value.trim(), ticket };
}
function isCurrent(operation) {
  return generation === operation.generation && ticket !== '' && ticket === operation.ticket && txKey($('tx-id').value) === txKey(operation.txId);
}
function render(view, operation) {
  if (!isCurrent(operation)) return false;
  if (txKey(view.txId) !== txKey(operation.txId)) throw new Error('RECEIPT_TX_MISMATCH');
  const index = levels.indexOf(view.level);
  if (index < 0) throw new Error('UNKNOWN_PROOF_LEVEL');
  $('level-tag').textContent = view.level;
  $('level-tag').className = 'tag ' + (index === 0 ? 'reported' : 'verified');
  document.querySelectorAll('.levels li').forEach((row, i) => {
    row.classList.toggle('reached', i > 0 && i <= index);
    row.classList.toggle('reported', i === 0);
    row.querySelector('.step-status').textContent = i === 0 ? '数据源报告' : i <= index ? '已验证' : i === 3 ? '等待状态证明' : '缺少证据';
  });
  $('evidence-meta').hidden = false;
  $('meta-tx').textContent = view.txId;
  $('meta-level').textContent = view.level;
  $('meta-source').textContent = view.source || '未提供';
  $('meta-height').textContent = view.height || '未证明';
  $('meta-reason').textContent = [view.reason, view.detail].filter(Boolean).join(' · ') || '未提供';
  notice(view.detail || '已显示本次最高可证明等级。缺少的证明不会被推断为成功。');
  return true;
}
async function status() {
  const statusTicket = ticket;
  const value = await api('/api/status');
  if (!ticket || ticket !== statusTicket) return;
  controls(true);
  const anchor = value.checkpoint;
  $('anchor-summary').textContent = value.anchorConfigured && anchor ? '独立检查点 · ' + anchor.source + ' · 高度 ' + anchor.height + ' · 信任期至 ' + anchor.trustUntil : '独立检查点：尚未配置。RPC 查询不会取得独立验证标识。';
  $('pair-state').textContent = '已配对本机 helper · 查证权限 · ' + (value.anchorConfigured ? '已载入独立检查点' : '尚未配置独立检查点，查询保持仅 RPC 报告');
}
$('tx-id').addEventListener('input', () => invalidateEvidence('交易已更改，请重新查询或导入对应证明。'));
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault(); $('pair-button').disabled = true;
  try {
    const challenge = await api('/api/pair/challenge');
    const result = await api('/api/pair', { challenge: challenge.challenge, code: $('pair-code').value.trim() });
    $('pair-code').value = ''; ticket = result.ticket;
    sessionStorage.setItem('ynxNetworkTicket', ticket);
    invalidateEvidence(); await status();
    notice('配对完成。可以查询公开 RPC 报告，或导入证明在本机验证。');
  } catch (error) { notice(error.message, true); }
  finally { $('pair-button').disabled = false; }
});
$('revoke').addEventListener('click', async () => {
  invalidateEvidence('正在撤销本次查证权限。'); controls(false);
  try {
    await api('/api/revoke');
    clearPairing('配对已撤销，原票据失效。重启 helper 后可重新配对。');
    notice('查证权限已撤销。资源贡献保持关闭。');
  } catch (error) {
    clearPairing('本页票据已清除；helper 的撤销结果尚未确认，请关闭 helper。');
    notice('撤销结果未确认：' + error.message, true);
  }
});
$('lookup-form').addEventListener('submit', async event => {
  event.preventDefault(); const operation = startOperation(); $('lookup-button').disabled = true;
  try {
    const result = await api('/api/lookup', { txId: operation.txId });
    if (!render(result.view, operation)) return;
    $('raw-panel').hidden = false;
    $('raw-report').textContent = JSON.stringify(result.report, null, 2);
    notice('这是 RPC 数据源的原始报告。尚未独立证明交易包含、执行成功或资金到账。');
  } catch (error) { if (isCurrent(operation)) { invalidateEvidence(); notice('查询未完成：' + error.message, true); } }
  finally { $('lookup-button').disabled = !ticket; }
});
$('proof-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const operation = startOperation(); $('proof-file-name').textContent = file.name;
  try {
    if (file.size > 3 * 1024 * 1024) throw new Error('证明文件超过 3 MiB');
    const proof = JSON.parse(await file.text());
    if (!isCurrent(operation)) return;
    const view = await api('/api/verify', { txId: operation.txId, proof });
    render(view, operation);
  } catch (error) { if (isCurrent(operation)) { invalidateEvidence(); notice('证明未通过：' + error.message, true); } }
  finally { event.target.value = ''; }
});
if (ticket) status().catch(error => notice(error.message, true));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
