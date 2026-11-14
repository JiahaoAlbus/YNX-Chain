# Post-R2 trace child count correction

PUBLIC24 and the original A/B results remain sealed with PrivacyTorPlatform
`0e480f0b...b1df3`. This correction changes only the QA recorder, not the product
path fence, backend startup, supply, bootstrap readiness, TLS or privacy gate.

Apple's public `proc_listchildpids` wrapper already returns the number of PIDs,
converting the underlying byte count internally. The old recorder divided that
number by `sizeof(Int32)` again and therefore missed an only child. Primary source:
[Apple libproc.c](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c#L81-L89).

The old observer method is preserved verbatim in
`R2ManagedChildCountLegacy.fixture`, extracted before modification from the exact
PUBLIC24 source. Its method SHA256 (excluding final newline) is
`d17b0cf4101d61dba39b374a61ef8d75ae3796f2eba63239991885bb66e1202a`.
The counterexample compiles that actual old method into the current recorder
facade and exercises the real public OS API: one owned harmless `/bin/cat` child,
raw API count1, but zero child events. The fixed actual observer records1/2/3
unique owned children, does not duplicate them on a later sample, and enumerates
zero after all original children exit0 from their owned stdin EOF.

These synthetic test parents/children are explicitly not Arti or transports.
They open no network or GUI and create no authority. The prior A/B recorder's
missing PT events were supplemented by external pinned process identities, not
retrofitted using this new source.

Standalone offline CI delta:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_r2_managed_child_count.py "$RUNNER_TEMP/ynx-r2-managed-child-count-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
```

The existing 36 R2 controls and all previous backend/GUI/network tests are not
repeated by this driver. Actual vendor trace consumption of the corrected
enumerator remains NOT_RUN; next source-cohort integration is owned by the parent.
