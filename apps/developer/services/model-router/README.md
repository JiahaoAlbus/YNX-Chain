# AI model admission

The router uses the authenticated workspace owner supplied by Agent Orchestrator.
It never trusts an owner identifier in the browser's model configuration. Model
keys remain request-only and are not part of scheduling metrics or returned data.

One router process runs at most four model requests by default, at most two
against the hosted CPU service, and at most one per owner. Waiting owners receive
round-robin turns; each owner can queue eight requests within a global queue of
64. A request waiting for 60 seconds expires before calling its provider. Client
cancellation removes pending work or aborts a running provider request.

Configuration uses `YNX_CODE_AI_CONCURRENCY`, `YNX_CODE_AI_QUEUE`,
`YNX_CODE_AI_OWNER_CONCURRENCY`, `YNX_CODE_AI_OWNER_QUEUE`,
`YNX_CODE_HOSTED_AI_CONCURRENCY`, `YNX_CODE_AI_QUEUE_TIMEOUT_MS`, and
`YNX_CODE_AI_TIMEOUT_MS`. These are resource limits, not measured throughput.
The model catalog reports aggregate occupancy and the process-local scope; it
does not disclose other owners, prompts, credentials or queued task details.

Owner queue saturation returns `model_owner_queue_full` (429), global saturation
returns `model_queue_full` (503), queue expiry returns `model_queue_timeout` (504),
and cancellation returns `model_request_cancelled` (499). These results never
claim a model or downstream tool completed. Provider responses retain their
existing independent authentication and rate-limit errors.

This revision does not coordinate multiple gateway processes. A shared broker
or owner-affine routing with distributed quotas is required before scaling the
gateway horizontally. The existing hosted upstream still has its own queue and
IP limiter; their tenant mapping and measured capacity require separate release
verification. The 100-owner synthetic test checks scheduling and cleanup, not
100 simultaneous real model generations or production capacity.
