# First-freeze observed results

Overall: NOT_COMPLETED. Browser protocol QA: PARTIAL, not an all-pass report.
Authoritative captured result: browser-federation-latest.json. Its seven passed
checks are actual isolated Chromium + two Synapse + Rust crypto behavior:
initialization, unverified-send block, standard SAS match/both confirmation,
bidirectional ciphertext text and peer decryption, both server encrypted event
readbacks, one-direction encrypted attachment/peer download, and browser process
restart with original device crypto and offline-arriving history. Both operators
are isolated local containers on this host, not independent production operators.

The subsequent verification rejection still timed out waiting for a pending
request phase. It is FALSE/UNRESOLVED, not passed. A prior attempt incorrectly
selected an older request; the revised exact-request selection still failed. Do
not infer the cause or delete the failure. Bidirectional attachments, added/
changed/revoked device runtime, backup and new-device recovery are untested. Page
errors were [] at failure capture, but the final console-pageerror-zero success
step did not run. Console0/public acceptance is NOT_PROVEN. QA ran transport
methods, not the full normal Social/Wallet UI or mounted production bridge.

Pass: Social typecheck; Native/API/crypto38/38; new policy/generation/receiver6/6;
Go internal/social and internal/chat. Tests include deferred-trust and upload
account replacement, and GREY/RED blocking without plaintext/attachment-key read.

Additional broad command was executed and FAILED, not hidden:
node --test apps/social/web/*.test.mjs packages/wallet-auth/test/social-central-browser-session-registry.test.mjs
Observed39 pass/13 fail. Ten network-controls VM cases fail at inherited browser
pagehide hook with ReferenceError:addEventListener is not defined; the standalone
network-controls rerun has1pass/10fail. Two inherited browser-test imports require
@playwright/test, absent from this isolated installation (new QA uses playwright).
The shared registry test cannot resolve @noble/hashes from packages/wallet-auth;
this owner installed deps only inside authorized apps/social, not shared source.
These are real test-run failures. No baseline comparison was executed, so this
report does not assert they are pre-existing or prove absence of regressions.
No opt-in user Chrome or production builds were launched to force green results.

Brand source: approved apps/wallet-web/public/ynx-logo.png read-only, copied to
apps/social/web/assets/ynx-logo.png with no pixel edit/redraw. Source SHA256:
38196080c2d56746fb37094abe68d1d89eabd8a2b29ab4f17bae48ac7e3effde.
Header/favicon/YNX chooser/connected state now reference the PNG; object-fit
contain preserves the supplied aspect ratio. MetaMask branding is unchanged.
New private-chat controls inherit existing blue/white CSS variables with explicit
mobile/focus/disabled styles. Protocol details are secondary. Visual desktop/
mobile/native acceptance remains unexecuted, not inferred from stylesheet text.

Recovery carriers: local runtime JSON and profile/server data remain private in
OS temp directories, never copied into Git. Four superseded QA container pairs
were stopped; this candidate's remaining QA pair(s) are loopback-only and will
be stopped after evidence capture. No real message/key/account or public chain
was changed. The final Git commit/tree and SHA inventory bind source and this
non-sensitive evidence; they do not authorize production deployment.
