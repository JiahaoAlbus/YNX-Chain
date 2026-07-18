const DB_NAME = 'ynx_product_device_v1';
const KEY_STORE = 'keys';
const REPLAY_STORE = 'replays';
let bearer = '';

export const token = () => bearer;

export async function startWalletAuth(surface) {
  const config = await requestJSON('/api/auth/config?surface=' + encodeURIComponent(surface));
  if (config.gateway !== 'available') throw new Error('Central Wallet Gateway is unavailable.');
  exactConfig(config, surface);
  const pair = await deviceKey(surface);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const compressed = new Uint8Array(33);
  compressed[0] = 2 + (publicRaw[64] & 1);
  compressed.set(publicRaw.slice(1, 33), 1);
  const now = new Date();
  const request = {
    version: '1',
    nonce: randomBase64url(32),
    chainId: config.chainId,
    requestingProduct: config.requestingProduct,
    productClientId: config.productClientId,
    bundleId: config.bundleId,
    productDeviceAlgorithm: config.productDeviceAlgorithm,
    productDeviceKey: base64url(compressed),
    callback: config.callback,
    scopes: [...config.scopes].sort(),
    purpose: localizedPurpose(surface),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 60_000).toISOString(),
  };
  sessionStorage.setItem('ynx_wallet_pending', canonicalJSON(request));
  const encoded = base64url(new TextEncoder().encode(canonicalJSON(request)));
  location.assign('ynxwallet://authorize?request=' + encoded);
}

export async function completeWalletCallback() {
  const query = new URLSearchParams(location.search);
  const encoded = query.get('response');
  if (!encoded) return null;
  const pendingText = sessionStorage.getItem('ynx_wallet_pending');
  if (!pendingText) throw new Error('Wallet callback has no matching request on this device.');
  const pending = JSON.parse(pendingText);
  const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64url(encoded)));
  for (const field of ['nonce', 'chainId', 'requestingProduct', 'productClientId', 'bundleId', 'productDeviceAlgorithm', 'productDeviceKey', 'callback', 'purpose']) {
    if (response[field] !== pending[field]) throw new Error('Wallet callback binding mismatch: ' + field);
  }
  if (canonicalJSON(response.grantedScopes) !== canonicalJSON(pending.scopes) || Date.parse(response.expiresAt) > Date.parse(pending.expiresAt) || Date.parse(response.expiresAt) <= Date.now()) {
    throw new Error('Wallet callback scope or expiry mismatch.');
  }
  const replayKey = response.requestDigest + ':' + response.nonce;
  if (await replaySeen(replayKey)) throw new Error('Wallet callback replay rejected.');
  const challengeEnvelope = await requestJSON('/api/auth/gateway/challenges', { method: 'POST', body: JSON.stringify(response) });
  const challenge = challengeEnvelope.challenge || challengeEnvelope;
  const pair = await deviceKey(response.productClientId.includes('seller') ? 'seller' : 'buyer');
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode('YNX_PRODUCT_SESSION_CHALLENGE_V1\n' + canonicalJSON(challenge))));
  const completion = { challenge, deviceSignature: base64url(rawSignatureToDER(signature)) };
  const session = await requestJSON('/api/auth/gateway/sessions', { method: 'POST', body: JSON.stringify(completion) });
  if (typeof session.token !== 'string' || session.token.length < 24 || session.account !== response.account || Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error('Central Gateway returned an invalid product session.');
  }
  bearer = session.token;
  await markReplay(replayKey);
  sessionStorage.removeItem('ynx_wallet_pending');
  history.replaceState({}, '', location.pathname + location.hash);
  return Object.freeze({ account: session.account, expiresAt: session.expiresAt });
}

export function clearWalletSession() { bearer = ''; }

function exactConfig(config, surface) {
  const expected = surface === 'seller'
    ? { client: 'ynx-seller-v1', bundle: 'com.ynxweb4.seller-console', callback: 'ynxseller://wallet-auth/callback', scopes: ['account:read', 'shop:seller:operate'] }
    : { client: 'ynx-shop-v1', bundle: 'com.ynxweb4.shop', callback: 'ynxshop://wallet-auth/callback', scopes: ['account:read', 'shop:orders:write', 'shop:profile:write'] };
  if (config.version !== '1' || config.chainId !== 'ynx_6423-1' || config.productDeviceAlgorithm !== 'p256-sha256' || config.productClientId !== expected.client || config.bundleId !== expected.bundle || config.callback !== expected.callback || canonicalJSON(config.scopes) !== canonicalJSON(expected.scopes)) {
    throw new Error('Unsafe Wallet product registry binding.');
  }
}

function localizedPurpose(surface) {
  const language = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
  const code = language.startsWith('zh-tw') || language.startsWith('zh-hant') ? 'zh-TW' : language.startsWith('zh') ? 'zh-CN' : ['ja','ko','es','fr','de','pt','ru','ar','id'].find(value => language.startsWith(value)) || 'en';
  const seller = { en:'Operate only my authorized YNX Shop seller records on ynx_6423-1 for four minutes.', 'zh-CN':'授权在四分钟内仅操作本人获准的 ynx_6423-1 商城卖家记录。', 'zh-TW':'授權在四分鐘內僅操作本人獲准的 ynx_6423-1 商城賣家記錄。', ja:'4分間、ynx_6423-1上で許可された自分のYNX Shop販売者記録のみを操作します。', ko:'4분 동안 ynx_6423-1에서 승인된 내 YNX Shop 판매자 기록만 운영합니다.', es:'Operar durante cuatro minutos solo mis registros autorizados de vendedor de YNX Shop en ynx_6423-1.', fr:'Gérer pendant quatre minutes uniquement mes données vendeur YNX Shop autorisées sur ynx_6423-1.', de:'Vier Minuten lang nur meine autorisierten YNX-Shop-Verkäuferdaten auf ynx_6423-1 bearbeiten.', pt:'Operar por quatro minutos apenas meus registros autorizados de vendedor do YNX Shop em ynx_6423-1.', ru:'В течение четырех минут работать только с разрешенными мне записями продавца YNX Shop в ynx_6423-1.', ar:'تشغيل سجلات بائع متجر YNX المصرح بها لي فقط على ynx_6423-1 لمدة أربع دقائق.', id:'Operasikan selama empat menit hanya catatan penjual YNX Shop saya yang diizinkan di ynx_6423-1.' };
  const buyer = { en:'Manage my YNX Shop profile, cart, and orders on ynx_6423-1 for four minutes.', 'zh-CN':'授权 YNX 商城在四分钟内管理本人于 ynx_6423-1 的资料、购物车和订单。', 'zh-TW':'授權 YNX 商城在四分鐘內管理本人於 ynx_6423-1 的資料、購物車與訂單。', ja:'YNX Shopに4分間、ynx_6423-1上の自分のプロフィール、カート、注文の管理を許可します。', ko:'YNX Shop에 4분 동안 ynx_6423-1의 내 프로필, 장바구니 및 주문 관리를 허용합니다.', es:'Autorizar durante cuatro minutos a YNX Shop para gestionar mi perfil, carrito y pedidos en ynx_6423-1.', fr:'Autoriser YNX Shop pendant quatre minutes à gérer mon profil, mon panier et mes commandes sur ynx_6423-1.', de:'YNX Shop vier Minuten lang erlauben, mein Profil, meinen Warenkorb und meine Bestellungen auf ynx_6423-1 zu verwalten.', pt:'Autorizar o YNX Shop por quatro minutos a gerenciar meu perfil, carrinho e pedidos em ynx_6423-1.', ru:'Разрешить YNX Shop на четыре минуты управлять моим профилем, корзиной и заказами в ynx_6423-1.', ar:'تفويض متجر YNX لمدة أربع دقائق لإدارة ملفي وسلتي وطلباتي على ynx_6423-1.', id:'Izinkan YNX Shop selama empat menit mengelola profil, keranjang, dan pesanan saya di ynx_6423-1.' };
  return (surface === 'seller' ? seller : buyer)[code];
}

async function requestJSON(path, options = {}) {
  if (location.pathname.startsWith('/seller-staging/') && path.startsWith('/api')) path = '/shop-api-staging' + path;
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const value = await response.json().catch(() => ({ error: 'Invalid server response' }));
  if (!response.ok) throw new Error(value.error || ('Request failed ' + response.status));
  return value;
}

async function deviceKey(surface) {
  const id = surface === 'seller' ? 'seller-p256' : 'shop-p256';
  const db = await openDB();
  const existing = await transactionResult(db, KEY_STORE, 'readonly', store => store.get(id));
  if (existing?.privateKey && existing?.publicKey) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  await transactionResult(db, KEY_STORE, 'readwrite', store => store.put({ id, privateKey: pair.privateKey, publicKey: pair.publicKey }));
  return pair;
}

async function replaySeen(id) {
  const db = await openDB();
  return Boolean(await transactionResult(db, REPLAY_STORE, 'readonly', store => store.get(id)));
}
async function markReplay(id) {
  const db = await openDB();
  await transactionResult(db, REPLAY_STORE, 'readwrite', store => store.put({ id, consumedAt: new Date().toISOString() }));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) request.result.createObjectStore(KEY_STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(REPLAY_STORE)) request.result.createObjectStore(REPLAY_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function transactionResult(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}
function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function randomBase64url(length) { const bytes = new Uint8Array(length); crypto.getRandomValues(bytes); return base64url(bytes); }
function base64url(bytes) { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function fromBase64url(value) { const normalized = value.replaceAll('-', '+').replaceAll('_', '/'); const raw = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(raw, char => char.charCodeAt(0)); }
function rawSignatureToDER(raw) {
  if (raw.length !== 64) {
    if (raw[0] === 0x30) return raw;
    throw new Error('Product device signature format is unsupported.');
  }
  const integer = part => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start++;
    let body = part.slice(start);
    if (body[0] & 0x80) body = Uint8Array.from([0, ...body]);
    return Uint8Array.from([0x02, body.length, ...body]);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}
