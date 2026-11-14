// Product requests may finish after sign-out, an account change, or a new store
// selection. Such responses must never enter the current workspace.
export class ContextChangedError extends Error {
  constructor() { super('The account or workspace changed.'); this.code = 'COMMERCE_CONTEXT_CHANGED'; }
}
export const contextChanged = error => error?.code === 'COMMERCE_CONTEXT_CHANGED';
// Display only reviewed classes. A transport or liveness response is never
// evidence that an earlier mutation failed or that a fresh action is safe.
export function merchantFailureMessage(error, locale = 'en') {
  const localized = (en, zh, zhHant) => locale === 'zh-Hans' ? zh : locale === 'zh-Hant' ? zhHant : en;
  switch (error?.code) {
    case 'MERCHANT_MUTATION_UNRESOLVED':
      return localized('The original request outcome is unconfirmed. Keep its original inputs and check the same request.', '原请求结果尚未确认。请保留原始输入并查询同一请求。', '原請求結果尚未確認。請保留原始輸入並查詢同一請求。');
    case 'ORIGINAL_AUTHORITY_REQUIRED':
    case 'ORIGINAL_ACTOR_REQUIRED':
    case 'AUTHORITY_SNAPSHOT_REQUIRED':
    case 'AUTHORITY_SNAPSHOT_MISMATCH':
    case 'AUTHORITY_UNAVAILABLE':
    case 'MERCHANT_AUTHORITY_NOT_CONFIGURED':
    case 'MERCHANT_AUTHORITY_UNAVAILABLE':
    case 'PAY_CANONICAL_AUTHORITY_NOT_CONFIGURED':
      return localized('Merchant authorization is unavailable. Keep the original request and check it again when access is restored.', '商户授权暂不可用。请保留原请求，待权限恢复后查询原请求。', '商戶授權暫不可用。請保留原請求，待權限恢復後查詢原請求。');
    case 'INVALID_SESSION':
    case 'MERCHANT_MEMBERSHIP_REQUIRED':
      return localized('The current merchant session cannot access this request. Use the original authorized account.', '当前商户会话无权访问此请求。请使用原授权账户。', '目前商戶工作階段無權存取此請求。請使用原授權帳戶。');
    case 'MERCHANT_MUTATION_OUTCOME_UNCONFIRMED':
    case 'MERCHANT_SESSION_OUTCOME_UNCONFIRMED':
    case 'PROVIDER_OUTCOME_RECOVERY_REQUIRED':
    case 'PROVIDER_RECEIPT_RECOVERY_REQUIRED':
      return localized('The original request outcome is unconfirmed. Keep its original inputs and check the same request.', '原请求结果尚未确认。请保留原始输入并查询同一请求。', '原請求結果尚未確認。請保留原始輸入並查詢同一請求。');
    default: return null;
  }
}
export function preserveOriginalMutationFailure(error, { dispatched = false, readback = false } = {}) {
  if ((!dispatched && !readback) || contextChanged(error) || merchantFailureMessage(error) !== null) return error;
  return Object.assign(new Error('The original merchant request outcome is unconfirmed.'), { code: 'MERCHANT_MUTATION_UNRESOLVED', cause: error });
}
export function createRequestContext(identity, { timeoutMs = 15000 } = {}) {
  let revision = 0;
  const active = new Set();
  function capture() {
    const at = revision, subject = identity();
    return () => { if (at !== revision || subject !== identity()) throw new ContextChangedError(); };
  }
  function invalidate() { revision++; for (const controller of active) controller.abort(); active.clear(); }
  async function fetchJSON(url, options = {}, fetcher = globalThis.fetch, decode = response => response.json()) {
    const assertCurrent = capture(), controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      assertCurrent();
      if (options.signal?.aborted) controller.abort();
      const response = await fetcher(url, { ...options, signal: controller.signal });
      const data = await decode(response);
      assertCurrent();
      if (!response.ok) {
        const code = typeof data?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(data.code) ? data.code : undefined;
        throw Object.assign(new Error(data?.error || `Request failed ${response.status}`), { status: response.status, ...(code ? { code } : {}) });
      }
      return data;
    } catch (error) { assertCurrent(); throw error; }
    finally { clearTimeout(timer); active.delete(controller); options.signal?.removeEventListener('abort', abort); }
  }
  return Object.freeze({ capture, invalidate, fetchJSON });
}
