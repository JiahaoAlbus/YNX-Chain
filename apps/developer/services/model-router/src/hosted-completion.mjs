import { readHostedStream } from './hosted-stream.mjs';
import { hostedReceiptHeaders, hostedOperationReceipt } from './hosted-receipt.mjs';

const LOCAL_PROTOCOL_ERRORS = Object.freeze({
  model_stream_invalid: 'YNX hosted model returned an invalid or incomplete stream.',
  model_output_too_large: 'Model output exceeded the response boundary.',
  model_receipt_invalid: 'YNX hosted model returned inconsistent receipt headers.',
});

// Consumes an already supplied response. This parser grants no generation or
// recovery authority and performs no request or status lookup.
export async function readHostedCompletion(response, { signal, callerSignal, sessionId, onOperation } = {}) {
  const headers = hostedReceiptHeaders(response);
  let stream;
  try {
    stream = await readHostedStream(response, signal, sessionId, {
      details: true, onMetadata(metadata) { onOperation?.(hostedOperationReceipt(headers, metadata)); },
    });
  } catch (error) {
    // A reader can reject with arbitrary code/message/status fields. Preserve
    // only our protocol codes and reconstruct even those messages locally.
    if (typeof error?.code === 'string' && Object.hasOwn(LOCAL_PROTOCOL_ERRORS, error.code))
      throw Object.assign(new Error(LOCAL_PROTOCOL_ERRORS[error.code]), { code: error.code, status: 502 });
    const cancelled = callerSignal?.aborted;
    const timeout = signal?.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw Object.assign(new Error(cancelled ? 'Stopped waiting for the AI request; remote cancellation is not confirmed.' : timeout ? 'YNX hosted model timed out.' : 'YNX hosted model response connection failed.'),
      { code: cancelled ? 'model_request_cancelled' : timeout ? 'model_timeout' : 'provider_unavailable', status: cancelled ? 499 : timeout ? 504 : 502 });
  }
  return { text: stream.text, model: headers.model, usage: headers.usage, requestId: stream.requestId,
    modelConfidence: headers.modelConfidence, usageConfidence: headers.usageConfidence, costConfidence: headers.costConfidence,
    operation: hostedOperationReceipt(headers, stream, 'completed') };
}
