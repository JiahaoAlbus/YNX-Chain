const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const invalid = () => Object.assign(new Error('YNX hosted model returned inconsistent receipt headers.'), { code: 'model_receipt_invalid', status: 502 });

export function hostedReceiptHeaders(response) {
  const confidence = name => {
    const value = response.headers.get(`x-ynx-ai-${name}-confidence`);
    if (value !== null && !['provider_reported', 'unknown'].includes(value)) throw invalid();
    return value || 'unknown';
  };
  const model = response.headers.get('x-ynx-ai-model');
  if (model !== null && !MODEL.test(model)) throw invalid();
  const modelConfidence = confidence('model');
  if (!model && modelConfidence === 'provider_reported') throw invalid();
  const requestId = response.headers.get('x-request-id');
  if (requestId !== null && !/^ai-[a-f0-9]{24}$/.test(requestId)) throw invalid();
  return { headerRequestId: requestId, model: model || null, modelConfidence,
    // The current SSE headers do not contain token counts. Confidence alone
    // must never turn missing usage into zero or a fabricated estimate.
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    usageConfidence: confidence('usage'), costConfidence: confidence('cost') };
}

export function hostedOperationReceipt(headers, metadata, delivery = 'UNKNOWN') {
  if (headers.headerRequestId && headers.headerRequestId !== metadata.requestId) throw invalid();
  const { headerRequestId: _untrustedHeaderId, ...receipt } = headers;
  return { ...receipt, requestId: metadata.requestId, sessionId: metadata.sessionId,
    state: 'UNKNOWN', remoteOutcome: 'UNKNOWN', delivery, nodeFinality: 'UNKNOWN', cancellation: 'unsupported' };
}
