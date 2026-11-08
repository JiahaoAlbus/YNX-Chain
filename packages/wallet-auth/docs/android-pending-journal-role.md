# Original Auth pending journal role

The original frozen producer did not previously have an SDK path. Baseline
commit 7bf7486d9dc2f5763fa4d56b56aad63d23e27982 maps 35 exact retained inputs
into native/android-pending-producer-role without changing their bytes.
JOURNAL_INTAKE.json then applies only the supplier's six logical CAS: four
modifications and two additions. All other 31 production inputs remain exact.
These are intake mappings, not replacement Source or crypto implementations.

CI checks each MOD against the actual baseline Git blob, all final input hashes,
the C11 layout, the nine new PUBLIC ASAN/UBSAN controls, and the two normal
Android arm64 API24 translation units and their strong journal getter exports.
The retained old producer test main is renamed and is not executed. No local
rerun of the old seventeen groups is required by this intake.

The getter only copies independently reviewed Root directory constraints from
the SAME pending Source. Native must additionally verify genuine OS parent and
leaf file descriptors. Observed FD values cannot populate reviewed Root rows.
Production rows remain empty. No reviewed tuple, actual Android runtime,
registration, Root/Source admission, whole JNI, APK or installation is supplied.
