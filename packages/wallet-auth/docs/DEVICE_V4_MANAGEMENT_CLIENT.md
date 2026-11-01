# Node-only original device V4 management client

`openOriginalProductSessionDeviceV4ManagementClient()` takes zero arguments and synchronously returns `{owner,errorPresent,error?}`. Adopt every non-null owner before interpreting the explicit flag. A false, null or undefined error remains a failure when errorPresent is true. No caller Source, provider, clock, endpoint, key or approval parameter is accepted.

Call `prepareReview(Object.freeze({signal: originalSignal}))` synchronously, then `producePreparedProof(SAMEcontext)` once. The client retains the same Native review and invokes the Native producer with that original review and context. Main's fixed six approval ports consume the Native review inside the Native producer; an SDK opaque review handle is never a Main approval peer. The original signal identity is retained.

The independent Source getters supply request/registration/body/session/approval/challenge/targetOperation originals, registry bytes and the registered device pair. Active/revoke/cancel require the independent registered session; completion recovery uses its original request/approval/challenge and target operation. The sole existing DATA codecs and full-AND device proof verifier are reused. The Native byte pair is converted to lower-case hex only at the existing verifier boundary; independent original bytes remain held and compared.

The four fixed Root capture originals are rootOriginal, enrollmentOriginal, profileOriginal and currentOriginal. Source and Review must expose the same captured tuple, reread before and after proof. This consistency test is not fresh Root verification. Native genuineRoot.current independently validates fresh current/transition with its protected policy, registration view, nonce, previous current and time. Refreshing a current nonce does not change the fixed capture tuple.

Original proof unsigned/member/body/outcome are captured before late current, abort or error interpretation. Failed/UNKNOWN attempts do not reacquire or sign again. readReviewDATA/readProofDATA return independent copies, including after failure, using this client's opaque handles.

`close()` preserves its first Promise. Cleanup strictly retires/joins/closes proof before review before Source. A pending/rejected join forbids later close or parent cleanup. `drainCleanup()` explicitly retries only remaining stages of the same held owners; it never replaces the first close Promise or first cause. The cleanup Promise is reserved before calling foreign retire, preventing reentrant duplicate drains.

Proposed package entry is `@ynx-chain/wallet-auth/original-product-device-v4-management-client`, with Node-only condition, explicit browser:null/default:null and its declaration file. Parent owns the package.json merge and official publication. The normal-layout Node24 import and browser refusal evidence use a temporary exact export layout; they are not published-package evidence.

Native Source final HANDOFF remains pending. This module matches the declared original Native API and Main cad971137 six-port contract; PUBLIC doubles and one real sole full-AND PUBLIC math packet verify the SDK boundary only. RootAdmission, SourceAdmission, NativeAdmission and connected remain false. There is no HTTP send, real account read, real key use, installation, restore/revoke E2E or business admission in this delivery.
