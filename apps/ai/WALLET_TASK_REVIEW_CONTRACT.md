# YNX AI product review and original Wallet task contract

This is the P08 product component for the existing P01/Auth/sole-SDK held review.
It adds no public proof schema, action, Root row, HTTP approval route or Native
factory. Local `AgentConfiguration` is configuration, not the independent Agent
identity used by Wallet. The existing SDK scope requires original `agentPublic`
(exact 15) and `currentSelector` (exact 3), independently current through Auth.
Never substitute a device/account pair or an `agentcfg_*` ID for that identity.

## Actual original callee

`(*TaskStoreSnapshot).ReadOriginalTaskReviewDATA() ([]byte, error)` borrows the
same `TaskStoreSource` snapshot already captured by original Auth composition.
`Server.OpenTaskStoreSource` keeps the original Server/Store association;
`Capture` selects the exact task/step/run, and `CaptureConversation` selects an
existing conversation before task creation. The getter creates no task, Grant,
reservation, nonce or execution. It performs no provider or Shop request.

The original recipient keeps this snapshot's `Current` and `Close` custody.
Recheck it before/after using returned DATA and at the actual held-review sign
fence. A configuration change/pause or successful Store write invalidates the
old snapshot. The JSON bytes do not carry a Source capability. Do not install a
JSON provider/setter or manufacture a Native getter to obtain them. Auth can
add its narrow forwarding method on its already held task-state owner; no P08
source factory or shared encoder needs replacement.

The returned JSON is owner-confined product DATA (`dataOnly:true`,
`authorityGranted:false`):

| Field | Actual meaning |
| --- | --- |
| `principal.Account/DeviceID/SessionID` | Original product principal from the retained capture; not Agent registration or signer authority. These keys retain the original Go DTO case. |
| `task` | Actual TaskRecord (id, holder, revision, generation, status, configuration binding); absent before task creation. |
| `operation.ID` | Actual service tool-step ID or internal run record ID. |
| `operation.ToolID/ToolVersion/Status/Revision/Generation` | Original operation metadata; not a fresh grant or completion claim. |
| `originalRequesterOperationId` | Original tool proposal operation ID, distinct from the service step ID. |
| `originalAuthorityOperationId` | Retained authority operation reference if one exists; never fabricated. |
| `originalRunId` | Original user run ID; `operation.ID` is its separate internal record ID. |
| `tool` | Service-owned tool id/version/purpose/risk for display and independent catalog comparison. |
| `resources` | Exact selected conversation/order/page/attachment/destination references; no record/page/file contents. Selection/version strings are DATA, not canonical Auth Ref constructors. |
| `input` | Actual original input byte count and full SHA3-512/SHA-512. `operation.InputDigest` is the separate existing product step+input digest. |
| `requestedFields` / `approvedFields` | Exact requested Shop fields / fields recorded by the product. Recorded approval is still checked against original current Auth authority before execution. |
| `localConfiguration` | Actual local configuration/state/revision; compare with task-bound revision. This is not the registered Agent list. |
| `model` | Fixed configured destination/model before a send, or exact labels from the retained admitted run. No API key, prompt, transcript or result body. Recorded labels do not prove availability. |
| `productLoopLimits` | Compiled safety ceilings: 8 model rounds, 16 tool calls, 2 minute runtime budget. Not Grant cap, remaining credit, money or expiry. |
| `historical` | Old holder/generation/revision/session context. It cannot be reused as a new execution review. |
| `authAgentIdentityState` | `ORIGINAL_AUTH_AGENT_SOURCE_REQUIRED`; qualified Agent identity comes from the independent original Auth Source. |
| `authBudgetAndExpiryState` | `ORIGINAL_AUTH_GRANT_SOURCE_REQUIRED`; no made-up or unlimited budget/expiry is returned by P08. |

Before a run exists, `task`/`operation` are absent instead of invented IDs. A
recorded run's page references/model labels are not borrowed by another session;
it receives historical metadata and `ORIGINAL_SESSION_SOURCE_REQUIRED`.
Destination URLs containing credentials/query/fragment are never returned.

## Auth-owned identity, budget and deadline

Wallet's same retained qualified review must join the original Agent registration,
Root/current/profile/device/session association and the exact P08 task/input
capture. The original Native/JSI/JNI getter and held-signing implementation remain
Auth/P01-owned; SDK's portable safe-core alone is not an operational Client.
Use actual original source/clock/custody, not product JSON as verifier input.

The existing original contract is `ynx.local/authgrantpolicy.HeldTaskGrantSource`:
`Snapshot(ctx)`, `AssertCurrent(ctx, SourceVersion)`, `FenceScope`,
`Retire/Join/Close`. Its snapshot supplies `Budget.Cap/SingleMax/Spent/Reserved/
Requested`, `Budget.Slot`, `Grant.ValidFrom/Expires`, `Snapshot.Expires`, and any
original disclosure deadline. These decimal strings and their original unit
must come from that same source. Do not default them to YNXT/USD, infer money from
an order total, round uint64 through JS numbers, or infer remaining credit from
P08 loop limits. Policy uses original millisecond timestamps/current fences.
UNKNOWN retains its original reservation; UI rejection/cancel is not its release.
If a pre-approval terms getter is missing in the original Native review, Auth
must supply its real typed callee; P08 does not synthesize those terms.

## Existing normal task calls and result distinctions

| User intent | Existing contract |
| --- | --- |
| Propose selected tool | `task.propose-tool-step`: POST `/api/tasks/{id}/tool-steps`, original operation ID, task revision/generation, tool/version, exact input. Proposal is not approval. |
| Approve original step | `task.approve`: POST `/api/tasks/{id}/tool-steps/{stepId}/approve`, `{authorizationRef}` from actual original authority. No boolean or model text can replace it. |
| Refuse Wallet review | Original Native approval port declines the SAME held review; no replacement proof, Grant or dispatch. Task cancellation is a separate action. |
| Execute approved step | `task.dispatch`: same step/ref, original task/holder/config/grant/resource/budget fences at effect edge. |
| Stop task scheduling | `task.cancel`: POST `/api/tasks/{id}/cancel`, exact `{revision,generation}`. Returns `futureDispatchClosed:true, remoteRollback:false`; sent/UNKNOWN operations remain. |
| Read events | `task.read`: GET `/api/tasks/{id}?afterCursor=N` (including 0); original bounded persisted task sequence. |
| Read same model result | `task.run-read`: GET `/api/tasks/{id}/runs/{originalRunId}`; source-authorized final return or metadata-only recovery. |
| Read same tool result | `task.step-result`: GET `/api/tasks/{id}/tool-steps/{sameStepId}/result`; exact original stored receipt. |
| Query uncertain original effect | `task.reconcile`: POST same step's `/reconcile`, original ref only; no new operation/nonce/effect retry. |
| Close verified local workflow | `task.complete`: exact task revision/generation and internal run record ID, not a new run. Local workflow commit is not external finality. |

Outer signed `OBSERVED` is a read; `COMMITTED` local task CAS is not tool finality.
Conversation/Shop read receipts retain their real COMMITTED resource scope.
WebDAV retains `CONTENT_PRESENT`, `external-content-observation-only` and
`authorshipProven:false`; it is historical content observation, not authorship.
No UI label may turn approval, a model answer or a transport ACK into execution.

Actual Agent pause/revoke belongs to Auth's original registered Agent/current
owner and Wallet UI. Product `/api/agents` returns explicitly local configurations;
its pause additionally invalidates revision-bound tasks and interrupts affected
model work. It neither revokes a registered Agent nor releases UNKNOWN budget.
P08 already checks configuration/task/current at execution and final return.
Preserve the original V2/UNKNOWN query-only version, original operation IDs,
first cause, account data and results across pause/restart. No API here supplies
asset private keys, Root keys, recovery phrases or a signing-key export.
