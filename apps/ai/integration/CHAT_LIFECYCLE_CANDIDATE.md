# Chat lifecycle candidate after 2c39

## Changes and evidence

- Cancellation aborts the captured browser generation immediately. Its later
  server-cancel response cannot abort a newer generation.
- BYOK stream metadata and persisted assistant history identify the selected
  provider, rather than labeling it as the hosted default.
- Explicit non-stop provider finish reasons and tagged thinking transcripts
  are rejected before a complete answer is emitted. Missing finish reasons
  remain supported for legacy compatible providers; this is not proof of
  semantic completeness. Untagged reasoning still needs quality evaluation.
- Message-save failure restores prior in-memory conversation, messages, and
  audit state. Tests exercise failed persistence, retry, encrypted restart,
  and rejection of another account's history reads and writes.
- A system instruction clarifies DApp connection versus transaction approval,
  prohibits requesting key disclosure, and requests final answers only.
  Prompt instructions alone do not establish model quality or safety.

Local regression: Go aigateway and aiproduct passed; both executable entry
packages compiled. All 47 browser-module tests passed, including immediate
cancellation, retry draft preservation, cross-conversation stream isolation,
truncated SSE, account changes, and BYOK credential cleanup.

## Performance and resource budget

This candidate creates no model service, changes no model selection or keys,
and adds no retries or background inference. Cancellation is immediate locally;
remote cancellation remains best effort. Final-answer checks are linear in
bounded response size. Persistence rollback retains references to prior state
under the existing store lock, without duplicating the full history.

The prior existing-Ollama qwen2.5:1.5b sample used one thread, 96 output-token
budget, 1024 context, a 60-second HTTP deadline and 65-second process deadline.
It completed 62 tokens in 12.1 seconds, but was not accepted for answer quality.
The new system instruction has not yet been evaluated against that model.
No new CPU inference is authorized by this document.

## Release and remaining acceptance

Rebuild both AI client and model Gateway through the sole release owner.
Preserve 18114/6429, state, keys, and the default model. Respect the current
SSH/deployment pause. Local tests do not prove public authenticated chat,
real Wallet callback/revocation, BYOK generation, or default-model recovery.
Model-quality evaluation must inspect final answers, not merely SSE delivery.
