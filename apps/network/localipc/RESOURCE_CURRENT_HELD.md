# Original resource Current held connection

This extends the existing private Unix HTTP `Request`/`Response` channel only.
The first `resource_current {}` on a correctly configured protected connection
borrows one concrete `contribution.ResourceCurrentReader`. Later Current,
`resource_current_retire {}`, `resource_current_join {}` and
`resource_current_close {}` use that same fd, peer, session and reader. There is
no wire initializer, registration, Root setter, resource selector, signing or
dispatch operation. The original9 DATA and fixed20s lifetime remain unchanged.

`localipc.Config.ResourceCurrent` is optional immutable trusted host composition:
the actual original Runner, Root-selected resource triple and independently
qualified native caller's `ProcessIdentity`. Start checks that actual native
caller and captures this Go server's actual OS PID/start/image. Normal absent
Root/reference/native capture leaves this field nil; the original one-shot
unsigned reader remains available without conferring issuer/Root authority.
`cmd/ynx-network-helper/resource_current_held.go` checks the same real existing
store for that future private host assembly. It does not initialize a store or
pretend that Native-only selection/registration has been supplied.

The protected server checks actual same-user socket credentials, PID, OS start
identity, executable path and bytes SHA on each frame and after each read. The
consumer independently checks the server against its original native trusted
expected identity, never against response JSON. Node PIDs, endpoint files and
same UID do not substitute for Go image/start identity. Darwin uses libproc's
`PROC_PIDTBSDINFO` and `proc_pidpath`; Linux uses kernel proc startticks/boot ID
and the kernel executable link/inode. No-cgo Darwin is unsupported for this
held identity path, rather than accepting self-reported image DATA.

`OpenResourceCurrent` returns a nonnil partial after the first wire attempt,
even on a lost response. Its `Current`/`ReadCurrentResourceDATA`/`Retire`/`Join`/
`Close` never redial. Failed/canceled Current seals new reads but preserves
original cleanup. The outer observation contains the same `sessionId`, actual
server/caller identities and borrow lifecycle. It remains unsigned DATA, not
NAPI capture, registered current-role signing, Source admission or permission.
Only a successful same-session Close acknowledgement proves remote physical
completion. A lost connection remains UNKNOWN; server-side eventual drainage
cannot be invented as a client acknowledgement.

Only an already authenticated concrete typed borrow receives a bounded60s
idle window. The ordinary server/other connections retain their original3s
idle timeout. Disconnect retires the published acquisition attempt immediately;
the same retained reader drains after its actual outstanding reads. Partial
acquisition and prior read errors cannot replace the reader. Server shutdown
holds its original endpoint/store lease until all those readers physically
drain, even if a particular `Server.Close(ctx)` caller times out.

Original LINK owns the native-only client registration/fence and its protected
reference; original Auth owns NAPI opaque capture/Root binding/lifetime. The
fixed public contract is `resource_current_protocol.h`. Its observations do
not authorize those components or replace SDK current9 framing/signature/math.
The C++/Go tests are explicitly PUBLIC/CONTROLLED kernel/original-store cases,
including same-fd lifetime, real same-PID exec image change, foreign same-UID
PID refusal, partial errors, original mutex/read debt and an independent C++
OS identity check. They do not qualify a genuine issuer, Root or production
fence. The original cmd CI invokes these new tests automatically.
