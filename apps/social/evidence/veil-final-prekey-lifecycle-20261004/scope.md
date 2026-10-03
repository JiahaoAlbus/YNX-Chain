# Final adapter prekey lifecycle regression

The eight SDK-backed lifecycle assertions previously ran before callback/address
entry guards changed. This run executes the unchanged lifecycle check against
the final 4ca2d60 adapter, also present unchanged in b900924. All eight pass,
exit 0. JVM class-load origins and input checksums are recorded in binding.txt.
This is a regression for changed prekey callbacks, not an unrelated full-suite
rerun or an independent review. The original ten JNI checks are not rerun here.

The SDK performs real key-record operations, but admission and transaction
persistence remain synthetic proof / controlled memory. Production directory,
revocation, actual Android Keystore/SQLite, authenticated monotonic anchors,
full crypto and product acceptance remain open. No production activation,
deployment, wallet requests, signatures, transactions, or key exports occurred.

native-adapter-check.sh adds an explicit-mode reproducible QA entry point. It
rebuilds the native Kotlin port and Java adapter from current source, requires
provided existing dependency paths, pins the official JAR checksum, and can
run the separately selected keyless, lifecycle, or checksum-pinned original
independent probe. It downloads or installs nothing. Compile-only execution
is distinct from runtime assertions, Android runtime proof, and release gates.
