import { createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter } from './vendor/wallet-sdk-9840ef87/product-session-browser.mjs';

const $ = (id) => document.getElementById(id);
const scopes = ['files.read'];
let adapter;
let state;
let generation = 0;
let controller;
let page = { parentId: '', cursor: '' };

function invalidate() {
  generation += 1;
  controller?.abort();
  controller = new AbortController();
  $('files').replaceChildren();
  $('content').textContent = '';
  $('files-status').textContent = '';
  $('more').hidden = true;
  return generation;
}

function render(result) {
  state = result;
  const connected = result?.status === 'connected' && result.session?.account;
  $('account').textContent = connected ? result.session.account : '';
  $('load').disabled = !connected;
  $('disconnect').disabled = !adapter;
  $('open-wallet').hidden = true;
  $('open-wallet').removeAttribute('href');
  if (connected) $('session-status').textContent = '私有会话已由 Wallet 确认。文件读取仍需每次单独验证权限。';
  else if (result?.status === 'connecting' && result.route?.status === 'ready') {
    $('open-wallet').href = result.route.url;
    $('open-wallet').hidden = false;
    $('session-status').textContent = '请求已准备。请点击下方链接尝试打开钱包；尚未确认安装或登录。';
  } else $('session-status').textContent = `私有会话状态：${result?.status || '未连接'}`;
}

async function lifecycle(action) {
  const epoch = invalidate();
  $('connect').disabled = $('restore').disabled = $('disconnect').disabled = true;
  $('load').disabled = true;
  $('open-wallet').hidden = true;
  try {
    const result = await action();
    if (epoch !== generation) return;
    render(result);
  } catch (error) {
    if (epoch !== generation) return;
    state = null;
    $('account').textContent = '';
    $('session-status').textContent = `会话操作未完成：${error.code || error.message || '未知错误'}。不会清除标准钱包连接。`;
  } finally {
    if (epoch === generation) {
      $('connect').disabled = $('restore').disabled = !adapter;
      $('disconnect').disabled = !adapter;
    }
  }
}

async function api(path, epoch) {
  if (state?.status !== 'connected') throw new Error('私有会话未连接');
  const auth = await adapter.createIntrospectionProof(scopes);
  if (epoch !== generation) throw new DOMException('Superseded', 'AbortError');
  const response = await fetch(`/api/v1${path}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', headers: { 'X-YNX-Product-Session-Proof-V2': auth.proofHeader } });
  if (epoch !== generation) throw new DOMException('Superseded', 'AbortError');
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    if (response.status === 401 && epoch === generation) {
      state = null;
      $('load').disabled = true;
      $('account').textContent = '';
      $('session-status').textContent = '私有权限已失效，请恢复或重新授权。';
    }
    throw new Error(failure.code || failure.error || `HTTP ${response.status}`);
  }
  return response;
}

async function list(parentId = '', cursor = '') {
  const epoch = invalidate();
  $('files-status').textContent = '正在读取授权文件…';
  try {
    const query = new URLSearchParams({ parentId, limit: '50', cursor });
    const response = await api(`/objects?${query}`, epoch);
    const result = await response.json();
    if (epoch !== generation) return;
    if (!Array.isArray(result.items)) throw new Error('文件列表响应格式不匹配');
    for (const item of result.items) {
      if (typeof item.id !== 'string' || typeof item.name !== 'string') throw new Error('文件记录格式不匹配');
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = `${item.kind === 'folder' ? '文件夹 / ' : ''}${item.name}`;
      button.addEventListener('click', () => item.kind === 'folder' ? list(item.id) : open(item.id));
      li.append(button);
      $('files').append(li);
    }
    page = { parentId, cursor: result.nextCursor || '' };
    $('more').hidden = !page.cursor;
    $('files-status').textContent = `本页 ${result.items.length} 项。`;
  } catch (error) {
    if (epoch === generation) $('files-status').textContent = `读取未完成：${error.message}`;
  }
}

async function open(id) {
  const epoch = invalidate();
  try {
    const response = await api(`/objects/${encodeURIComponent(id)}`, epoch);
    const object = await response.json();
    if (epoch !== generation) return;
    if (object.id !== id || object.kind === 'folder') throw new Error('文件身份不匹配');
    const content = await api(`/objects/${encodeURIComponent(id)}/content`, epoch);
    const type = content.headers.get('Content-Type') || '';
    if (!type.startsWith('text/') && !type.includes('json')) {
      $('files-status').textContent = '文件访问已授权；此页面仅预览文本，不自动下载二进制内容。';
      await content.body?.cancel();
      return;
    }
    const body = await content.text();
    if (epoch === generation) {
      $('content').textContent = body;
      $('files-status').textContent = object.name;
    }
  } catch (error) { if (epoch === generation) $('files-status').textContent = `打开未完成：${error.message}`; }
}

$('connect').addEventListener('click', () => lifecycle(() => adapter.client.beginExplicit()));
$('restore').addEventListener('click', () => lifecycle(() => adapter.client.restore()));
$('disconnect').addEventListener('click', () => lifecycle(() => adapter.client.disconnect()));
$('load').addEventListener('click', () => list());
$('more').addEventListener('click', () => list(page.parentId, page.cursor));
window.addEventListener('pagehide', () => { invalidate(); adapter?.close(); });

try {
  const response = await fetch('/cloud/vendor/wallet-sdk-9840ef87/product-session-registry.json', { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('注册表无法读取');
  const registry = await response.json();
  const gateway = new ProductSessionGatewayFetchAdapter({ endpoint: 'https://wallet-auth.ynxweb4.com', fetch: globalThis.fetch.bind(globalThis), timeoutMs: 10000 });
  adapter = await createBrowserProductSessionClient({ registry, productId: 'cloud', scopes, purpose: 'Read my private YNX Cloud files.', gateway });
  const callback = location.pathname === '/wallet-auth/callback';
  await lifecycle(() => callback ? adapter.client.handleReturn(location.href) : adapter.client.restore());
  if (callback && state?.status === 'connected') history.replaceState(null, '', '/cloud/session.html');
} catch (error) {
  $('session-status').textContent = `私有会话未启用：${error.code || error.message}。必须使用注册的 HTTPS 站点和可用安全存储。`;
}
