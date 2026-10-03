# V2 codec boundary evidence

Production source commit: 55cb11c4a38baaffeddcab578999b11c75e9f18a.
This supplements, not replaces, the actual SessionCipher suite at that commit.
Java 24 javac --release21; official libsignal0.104.0 supplies synthetic keys.
No user keys/data, real device directory, anchor, provider, or activation.
Compile and runtime exits are retained in status.txt; 1059 assertions pass.
Checks cover every truncated prefix, 1..64 trailing bytes, every disallowed
ASCII control, UTF8 byte lengths, malformed UTF16, device limits, maximum
content, zero/oversized content/envelope, and 732 structured byte mutations.
473 accepted mutations reencode exactly; 259 are typed rejections. Acceptance
of syntactically valid changed fields is NOT trusted-context authentication;
the separate actual-SDK suite tests authenticated context mismatch rejection.

The compiled production classes were inherited from the preceding frozen
batch's final compilation, not a new cold native build. bindings.sha256 records
those exact classes, the QA source, native port and SDK used. This evidence
claims only codec input invariants; independent review remains required.

Reproduction after building the pinned dormant native adapter/classes:
javac --release 21 -cp "$STAGE/classes:$STAGE/native-port.jar:$SDK/*" -d "$STAGE/classes" apps/social/scripts/veil-libsignal-qa/VeilEnvelopeBoundaryCheck.java
java --enable-native-access=ALL-UNNAMED -Xcheck:jni -cp "$STAGE/classes:$STAGE/native-port.jar:$SDK/*" com.ynx.social.matrix.VeilEnvelopeBoundaryCheck
