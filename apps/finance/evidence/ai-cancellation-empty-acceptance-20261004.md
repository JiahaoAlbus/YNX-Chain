# Finance AI cancellation acknowledgement compatibility

Predecessor: 414fc05aaa5b8ae62284886090329b788247ef3b.
Ordinary product response handling only; authority, shared SDK, service implementation and formal release assets remain unchanged.

## Reproduction and fix

The existing real-Chrome cancellation regression failed independently: the cancellation button was re-enabled before the required bound job readback. Read-only inspection of internal/finance/server.go cancelAI confirmed the existing endpoint returns an empty HTTP 202. The strict product-document reader rejected this acknowledgement for missing JSON, so cancellation confirmation never progressed. A later polling read was not evidence of the requested action's confirmed outcome.

The product reader now accepts only an exactly empty 202 response for POST /api/ai/jobs/{id}/cancel (no query or fragment). Content length and streamed bytes remain bounded, with a zero-byte limit for this acknowledgement. The controller still must read the exact owned job, validate its id/kind and cancelled status before displaying cancellation; the acknowledgement alone is not cancellation success. Empty/nonempty documents elsewhere remain rejected. No relaxation of generic JSON, timeout, owner retirement or retry boundaries.

New transport regression covers the valid empty acknowledgement plus wrong method, endpoint, query, nonempty JSON/whitespace, inconsistent declared length and wrong status. Existing real Chrome now confirms the button stays disabled and aria-busy while exact readback is pending, only one cancellation is submitted, and cancellation appears after the exact response.

## Verification and limitations

Focused real Chrome cancellation PASS (1/1). Complete AI browser/controller/product-response group PASS (23/23, 9.779s). Final eight-group ordinary-flow run (AI browser/controller, response recovery, save browser/controller, overview browser, planning browser, read controller): 58/58 PASS, 44.171s. Existing server tests rerun without cache: go test -count=1 -race ./internal/finance PASS (18.925s). JavaScript syntax and git diff whitespace checks pass.

A broad npm suite scan exposed this bug and also reported protected release verifier and login scenarios. That scan was stopped during diagnosis; intermediate in-progress edit invocations were retired and are not accepted test evidence. The final ordinary-flow rerun is recorded separately. No protected verifier pins were changed to create a green result.

All Chrome/API responses here are controlled QA. Public deployment, installed release, real account approval, Product Session and financial execution remain unverified. No SSH/Host/service lifecycle or private-key action occurred.
