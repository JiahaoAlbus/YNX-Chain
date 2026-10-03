# Native publication storage completion continuation

Parent: ba59901839405c2849f7c7efada0f0beeeecd933.

This continuation supersedes earlier notes saying successful acknowledgement
removes the native publication carrier. Native SecureStore IO is not abortable:
removal already started could finish after close/account change. The carrier now
retains original body/nonce plus the checked returned record ID instead of being
deleted. A delayed write may record that already returned result, but cannot
erase the nonce. Same-original recovery does not send a replacement request.

The actual native restore button distinguishes a returned record from an
unconfirmed pending publication and requests normal feed readback. A checked
stored record ID is historical response data, not an authorization or proof of
current public presence, encryption, audience membership or stable identity root.

Explicit Create moment can start another publication after an acknowledged one,
including identical text. It cannot replace an uncertain original. New nonce
collision is refused before replacing the previous carrier. The carrier tracks
the current recovery intent, not a historical publication archive.

Software regression uses actual deferred native-storage Promise completion
after authority changes, restart recovery, no duplicate send, explicit new
publication and nonce collision. It is not an installed SecureStore device test.
Original user records, requests and keys are not reset or cleared.

Native Matrix/Rust, real HS/MXID/root, two nodes, restricted Moments, device and
public/installed acceptance remain NOT_VERIFIED. Shared integration and release
remain A-owned under Central NO_GO and a separate lease.
