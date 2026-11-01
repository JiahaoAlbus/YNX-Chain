# Original V6 mobile consumer integration

`src/taskV6.ts` consumes the sole SDK's `OriginalAITaskActionV6Client`
interface. `sdk047/*.d.ts` are byte-exact, type-only declarations from published
0475514dd461a3adf0ea316b941888a4677a3a19; hashes are in PROVENANCE.json.
No executable codec, canonicalizer, verifier, signer or Source is copied.

Normal product path: `Session.taskCredentials.v6` -> `createTaskAPI` ->
`createTaskV6API` -> SDK `prepare/prove/send`; `prove` owns SAME-held-review
production. The original bridge/SDK custodian must supply a freshly owned client
for this workspace, `nativeTaskV6Persistence`, and an operation-ID generator.
Workspace disposal aborts local requests and closes the original client;
`whenClosed()` exposes the original close completion/error to its parent.
P08 never creates a Native client from received JSON, an unsigned proof or a
public Source setter. A missing genuine client refuses new tasks before legacy
proof acquisition/network. Existing V2 reads and original reconcile remain V2.

The published 047 runtime export `original-ai-task-action-v6-client` is Node-only
(`browser:null`, `default:null`, imports node:util/Buffer). It cannot be imported
as an Expo/Hermes implementation. This product consumes its frozen types only.
The remaining minimum sole-SDK delta is an actual React Native compatible,
zero-input original client opener with this same finite interface, connected to
the original P01/Auth Native Source acquisition. Its own implementation must
preserve SAME held review, current/original bytes, outcome and query custody.
Do not turn the Source declaration into a product-side getter or fake bridge.
Auth/P01 must independently implement `acquireOriginalAITaskActionClientV6Source`,
review/produce/outcome/lookup and held-signing open_v3; no admission is implied.

V6 journal entries persist BEFORE SDK preparation/proof/send and retain only
version, original operation ID, action/task/binding/state and allowlisted cause.
No prompt, proof/member, Grant reference, model answer or private result is saved.
The V6 SecureStore namespace ends in `.v6`; V2 data is never copied/migrated.
UNKNOWN/PENDING blocks replacement effect/run IDs. Cold recovery uses retained
`lookupOriginal` only, returns opaque evidence DATA, and does not mark an operation
complete. Old V2 task/delivery metadata is query-only even under V6 credentials;
`recoverLegacyRun` uses the retained original V2 query transport without changing
that metadata. `task.handoff` remains unregistered by the sole SDK.

The PUBLIC client seams in consumer tests prove orchestration/failure handling,
not cryptography or Native/Source qualification. Actual installed-client approval,
server release registration and real tools remain separate acceptance gates.
Existing mobile CI already runs src/*.test.ts, typecheck and native builds.
