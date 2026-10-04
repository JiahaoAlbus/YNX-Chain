# Dormant official SDK snapshot / sodium JNI codec

Base 3b902974feca4ce853231b4765d3c5b3645149e1. This successor joins the
existing native SDK snapshot producer to the original veil_backup_seal/open
C ABI. It does not add identity authority, restore effects or an active module.

## Source and actual execution

VeilBackupNative is package-private and has no Expo/JS export, password String,
library downloader or auto-loader. The original native owner must load its
admitted library. It snapshots the existing native record transaction, calls
the original native backup seal/open, and runs current observers before and
after the synchronous work. Decrypted output goes only to import staging; no
record write, checkpoint advance, device enrollment or recovery grant exists.

veil_backup_jni.c validates sizes before native copying. Owned native input and
password copies use sodium_malloc/mlock and sodium_free; denial fails closed.
The original mature primitive remains unchanged: Argon2id13 (three passes,
64 MiB) and XChaCha20-Poly1305 with authenticated header/external context.
Caller password/context are preserved; temporary owned JVM copies are wiped.
JVM copies and SDK native handles are NOT a guaranteed OS memory-lock/erasure
claim. The JNI layer is a codec, not a password-review or identity provider.

Pinned libsignal 0.104.0 JAR checksum remains enforced by the original QA
runner. Native code links the existing official libsodium 1.0.22 static carrier;
runtime checks require exactly 1.0.22. Fresh Kotlin/Java compilation uses the
original current native authority/store/transaction sources. C compilation uses
-Wall -Wextra -Werror. The compiled desktop library is a QA artifact, not a
signed installable product or an Android/iOS build.

Actual -Xcheck:jni execution passed ten checks: unavailable library; SDK image
seal/open/staging; caller input preservation; wrong password; foreign valid
context; ciphertext tamper; invalid inputs; late seal observer; late open
observer; original backup usability after rejections. Context, trust, record
port and password are SYNTHETIC. No real account or key was collected.

Original run failed at the foreign-context fixture because its all-zero context
was invalid input, not a valid foreign context. Original run/status are retained.
Only that test input changed to a nonzero different context; the exact required
CONTEXT_MISMATCH assertion remains. No primitive or assertion was weakened.
final-run.txt records the corrected pass. repro-run.txt additionally validates
the standalone launcher, preserving the older snapshot evidence runner intact.

Reproduce with existing local dependencies, no downloads:

```sh
sh apps/social/scripts/veil-libsignal-qa/backup-codec-check.sh
```

## Remaining required native integration

The original native/shared owner must supply reviewed independent device and
identity admission, key namespace, generations/revocation, expected 32-byte
context, source/current rollback checkpoints and original operation binding.
A Runnable or a synthetic context is not that proof. The existing authority
and CheckpointProtector must authorize atomic import and unknown recovery;
never infer permission from successful decryption or the file's metadata.

Explicit native-only password review, actual platform sodium/JNI builds and
memory policy, cancellation review, LegacyReader/history migration, installed
UI, public source binding and full Social v2 / crypto649 remain unverified.
No deployment, new ratchet activation, real Wallet request, signing or
transaction occurred. Standard Wallet and private service gates remain separate.
