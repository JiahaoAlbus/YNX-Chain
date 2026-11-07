# Original P08 protected Native review UI

This directory implements the original Auth required **UI7** private port.
It never implements Auth approval7, SDK application6 or Native Agent7. A selects
exactly one platform source in its ONE matching image with the supplied CMake
function; linking both platform definitions is invalid. The private declaration
headers are byte-pinned in `contracts/mobile-protected-review/PROVENANCE.json`.
The five Auth headers also match the latest coherent `frozen-paired-FDAKuh` set.

Actual normal callers are Auth `MobileAITaskClient::produce` and its original
Native AI worker: acquire, current, claim once, current, then the distinct Agent.
Acquire rejects the main/UI thread. It stays on that original Native actor while
the actual main-thread view records a decision. A condition variable and bounded
Source-current checks keep the same operation/capture; no new nonce, intent,
second produce, JS approved flag, provider or permission setter is introduced.

The producer first obtains the original installed-App loan. It then borrows
`readOriginalProtectedReviewDATA(SAMEcapture)` before approval: exact validated
unsigned/message/body/scope/digest/Agent originals. It independently borrows the
existing Native **pre-capture registered-account V2 metadata** API in READY
phase, reads its public account/current epoch and rechecks its original current.
Only matching `com.ynxweb4.ai`, platform, account/canonical owner and network may
proceed. A Wallet-only account profile must fail; there is no App-ID alias,
alternative account selection or fallback. Account key version and task Agent
key epoch are separate labels, never assumed equivalent.

This metadata borrow does not call a restore/review claim, enter a primitive,
read43/DER/Agent keys, or treat the account picker/receipt as approval. NOT_READY
does not become READY and is not silently resumed or replaced. The normal
bootstrap must supply its genuine ready account before requesting a signature.
The observed original V2 headers are pinned but their actual AI-profile support
and matching normal implementation still require the original Native owner and
A's coherent full composition. Compiler/model results do not qualify that input.

iOS constructs a native UIKit form on the actual foreground App window. Android
uses an actual AlertDialog bound to the resumed MainActivity, FLAG_SECURE and
obscured-touch filtering. Its private JNI class is bound by the normal host;
Activity pause cancels/dismisses only that Activity's owned dialogs. No React
method or webpage can open/approve a loan. Body and metadata arrive through the
same captured Native producer. The Android presentation helper produces only
text; it cannot construct a review owner or an approval.

Both surfaces show actual action, target/origin, task/step/operation, native
account, separate account/Agent epochs, original expiry, digest and parameters.
Authorization references and credential fields are hidden. Missing budget stays
explicitly **not supplied**; an actual zero remains zero. This confirms only the
fixed task-request signature, not a ToolGrant, financial consent or execution
receipt. Those require their separate authoritative business confirmations.

Approve/reject/cancel are real native view events. The source actor rechecks the
same originals, installed App and Native account before claim. A changed body,
account/epoch, Source, capture or deadline refuses. Claim is selected once even
on failure. Source-only reads and a dismissed view can never become approval.
An approved receipt may remain current after its view has actually dismissed,
until the original Source/account/lifetime fence or explicit retirement fails.

Retirement only reduces lifetime. Close does not recheck expired Source and
does not infer dismissal from a timeout. UI work/dismissal ACK, original account
drain/release and installed loan close must all complete. Normal pending close
has failure absent plus physicalDone false; raw failure-present/code0 and cleanup
debt remain separate. No uncertain release or old operation is replayed.

Validation deliberately separates:

- Actual UIKit iPhone/iOS Simulator and Android NDK arm64/x86_64 source objects.
- Actual Android SDK/RN interface compilation and actual Auth approval7/UI7
  relocatable composition.
- PUBLIC Source/App/account/UI-boundary state controls under ASAN/UBSAN, and
  PUBLIC Unicode/redaction/missing-budget/foreign-identity presentation controls.
- **Not performed:** actual protected UI interaction, genuine AI account/current
  profile acceptance, Source/Root admission, signature, installed whole App,
  TLS, model/tool effects or business completion.

Use the existing CI checkers; do not rerun unrelated model/Hermes/SDK greens.
Original A must supply its actual signed manifest/image, the matching full Auth
and Native/SDK sources plus the sole math/Core/TLS image, and run normal installed
lifecycle/approval acceptance. These files are not a hot patch to an old image.
