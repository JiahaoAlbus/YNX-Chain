# Bounded streaming Quant response consumption

Owner predecessor `adc215fc1b7e847c821d995dd82a1594f4742347`.

The shipped HTTP consumer previously awaited `response.text()` before measuring
the full encoded body size. An absent/false Content-Length could therefore allow
an entire oversized response into memory before the 8 MiB rejection.

Browser fetch responses now use their native ReadableStream reader. Incoming
bytes are counted before decoding/retention, split UTF-8 is decoded incrementally
and strictly, over-limit/invalid streams are cancelled, and the existing 30-second
deadline aborts the request and cancels an active reader. Reader/listener resources
are released on completion. Fetch is also aborted when the transport finishes,
including early header rejection. No write is replayed by this behavior.

Legacy host/test adapters lacking a ReadableStream retain their existing bounded
text fallback; this fallback is not claimed to stream. Normal browser Responses
use the streaming branch. Shared SDK, provider, authority and engine are unchanged.

## Direct verification

- VM/UI cohort: `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs`
  90/90 PASS, 598.823292ms. Real Node Response/ReadableStream proves byte-split
  Japanese/Arabic/emoji survive; exact 8 MiB accepted; ninth 1 MiB chunk rejects
  with exactly one reader cancel and one fetch; invalid UTF-8 rejected; stalled
  native stream cancels at the controlled deadline; non-cooperative legacy
  response/text deadline coverage remains passing.
- Actual Chrome native-stream test: 1/1 PASS, 2077.152542ms. The shipped global
  `quantHTTP` processes real browser Response/ReadableStream with fragmented
  UTF-8, then rejects an endless oversized stream on pull 9; cancel=1, fetch=1,
  error=`QUANT_API_RESPONSE_INVALID`, tabs=1.
- Actual Chrome pending-intent/locale regression cohort: 2/2 PASS, 5206.529042ms.
  Reload/explicit local-forget and exact request retention through localized
  service rejection remain passing.
- Node syntax and `git diff --check` PASS.

Commands for browser cohorts:

```sh
node --test --test-name-pattern='actual Chrome native response stream' apps/quant-lab/tests/browser.test.mjs
node --test --test-name-pattern='actual Chrome localizes service errors|actual Chrome retains unreadable Paper' apps/quant-lab/tests/browser.test.mjs
```

All browser checks use the actual owned page on an isolated local Go server and
explicitly constructed response streams. No public runtime, capital execution,
Wallet approval, native installation or formal release is implied. Unique release
owner still must integrate and publish the compatible ordinary product delta;
the full Financial goal remains incomplete.
