# Dormant authenticated application envelope V2

Source base: 55ae2e58dabbdcd94db236b0b9cfdc3962323d75.
Contract SHA256: 448a674a280a4dfaa82b4cf9330ab596b847665886e99fa30cdfeff7c2e2d839.

The final SDK log records 31 individual PASS checks plus a scope-summary PASS.
The initial runner log records fresh Kotlin native-port/Java compilation and
an earlier smaller suite with selected_qa_exit=0. It is preserved as initial,
not relabeled as the final Java suite. final-java-compile.txt is the final
compiler output, followed by the final SDK run in the same shell chain.
The previous shell exit status was not retained separately across compaction.

Official libsignal 0.104.0 SessionCipher encrypts the exact authenticated V2
application bytes. Independent receiver operation IDs are not sender IDs.
Native consumer checks route, devices, pins, generations and epoch before
committing received messages. Replay, immutable retry and recovery are
protected-store records; final commit guards recheck admission. Any error after
attempted external anchor advancement requires recovery, never self-reset.

QA directory/provenance is explicitly synthetic. The port is atomic memory,
not Android SQLite/Keystore or a genuine durable monotonic anchor. Actual SDK
cross-room rejection is exercised after decryption, with zero candidate state
commits; it is not a substitute for independent source admission.

No production independent verifier exists. Default authority refuses before
private store access. No activation, deployment, signing, wallet authorization,
real device directory, group/fanout, migration, attachment/backup acceptance,
public/install evidence or dot/MONSTER acceptance is claimed.
Old failing evidence and prototype harnesses are preserved, not declared green.
Shared verifier, reviewed SDK provenance and native runtime scheduling remain
under Root/A coordination. Full Social and crypto goals remain open.
