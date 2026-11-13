# Android Wallet V4 account approval signer

Add the `ynx_android_account_approval` object target to the same Wallet Android
image that owns the protected review, original approval journal and the
existing `auth-ordinary` decoder and Android JCE binding. Its only signing
export is `ynx_wallet_v4_account_approval_sign_n1_v1`. It consumes the original
Auth typed-plan and F24 headers, Wallet's five same-holder ports, and Core's
fixed `product_session_approval_v4.h` from the selected single archive.

The Wallet claim must represent the original acknowledged durable ENTERED
operation. Native retains a nonnull partial loan before examining status.
It uses `decodeOriginalBackup` on the existing encrypted account backup and
checks the exact canonical binding, full public pair, owner and network
against the held plan. The same loan is checked before and after decoding and
around the fixed Core call. The signer consumes the SDK's original E5 directly.

Native preserves the bounded public Member even when Core, late current or
release fails. It wipes private material before selecting the original OS
release. The one private receipt records Core return and cleanup independently
from the actual OS loan release. An unreturned Core call or a claim without
a returned loan is not a successful cleanup observation. The original F24 is
preserved through receipt failure and returned with the independent Member.

Wallet persists and reads back the exact native receipt and original Member.
Auth still verifies the original operation and current policy before returning
the approval. These are requirements of the existing coordinator, not grants
provided by this target. A retained partial or lost acknowledgment is only
recoverable through the original holder and journal.

Validation uses the real frozen headers and two Android API 24 objects. The
host controls substitute public test-only custody and math callees. Positive
execution requires the actual protected Wallet holder, durable journal and
Core signer in the selected Android image.
