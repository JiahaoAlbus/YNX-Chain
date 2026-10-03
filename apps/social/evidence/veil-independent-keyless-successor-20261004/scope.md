# Unchanged independent keyless probe against successor

Subject: commit 4ca2d60ab6559a70c4da78baac6d77e46644f7cb,
tree 29ea5b70e64d6be13b933f9a96e55d79deed10f5.

The controller's frozen KeylessAdapterProbe.class was executed without edits.
SHA256: f7544c178d9dca44213c4c32e7e41cd2bbb038372602d2b44dbf99607a09ea2d.
The original reproduce-keyless.sh remains unchanged and still selects the old
frozen adapter. The successor run instead compiled only the successor adapter
against the already compiled current native port and actual official SDK, then
placed the new adapter classes before the frozen review classes on the JVM
classpath. No original failure evidence or review-owned files were changed.

The JVM class-load log in binding.txt confirms that the unchanged probe came
from the original independent review directory, the adapter came from the new
compilation, and the native authority/transaction/record kinds came from the
current native-port JAR. Checksums bind these inputs and the vendor JAR.
Temporary paths describe this run, not durable release artifacts.

Result: successful Java compilation and 6 PASS / 0 FAIL, exit 0. Exact peer
deletion/enumeration and rejection before expired serialization now satisfy
the original assertions. The live exact callback, refusal of legacy SenderKey
writes, and expired read rejection remain positive boundaries.

Execution used Zulu Java 24.0.1 with --release 21 for compilation and
--enable-native-access=ALL-UNNAMED -Xcheck:jni for execution. This is an owner
reproduction of an independent probe, not a new independent approval.
SOURCE_HOLD remains subject to controller/reviewer judgment.

This keyless probe uses native public addresses, synthetic admission, and a
controlled memory transaction. It does not verify real Android persistence,
Keystore, trusted identity approval, authenticated durable checkpoints,
production JNI integration, fresh SPQR contribution, migration, installed or
public behavior, ordinary users, or dot/MONSTER acceptance. No deployment,
activation, wallet authorization, signing, transaction, or private key export
occurred. Full Social and crypto objectives remain incomplete.
