# Exchange owned account response stream boundary

Predecessor: 91eea9d7a29bd4bc269417f1eefec67d6f5b80dd. Only ordinary Exchange account consumer/helper and direct tests changed; no shared SDK/protocol/authority or formal release graph changes.

The owned account reader previously consumed unbounded response.text(), then checked JavaScript character length against a 1 MiB limit. Now it reads native response.body chunks, bounds total UTF-8 bytes before retaining/decode, requires strict UTF-8 with cross-chunk decoding, rejects malformed/unsafe/oversize Content-Length, cancels invalid bodies without awaiting cancellation, and cancels on retired-context AbortSignal. Existing API deadline, cookie/proof, ownership validation, callback and Standard Wallet separation remain unchanged. No private write permission is added.

Executed local regression command: YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test apps/exchange/tests/private-account.test.mjs apps/exchange/tests/account-response-stream.test.mjs apps/exchange/tests/owned-record-integrity.test.mjs.

36/36 PASS, no skips in the opt-in actual Chromium/Go run. Covers actual browser host-only identity cookie forwarding, cross-account rejection, reload restoration, linked logout; deterministic stream regressions cover split UTF-8, oversize multi-byte body, first-chunk rejection, nonsettling cancellation, invalid/incomplete encoding, bad length headers, stalled-body retirement, deadline/guest/offline/close, and subsequent verified refresh.

The prior stalled-body fixture used only a fake text() response; it now provides the stream seam actually consumed by browsers. Native browser Responses are exercised separately by the actual Go/Chrome test. Controlled authority fixtures are not real Wallet approval, public private-session acceptance or installation proof.

App module syntax and git diff --check PASS. No deployment, account approval, signature, order or transaction was executed. Formal content pins/asset graph publication remain the sole release owner's responsibility; apply ordinary hunks without overwriting its graph. Rollback is inverse of these hunks, with no production state change.
