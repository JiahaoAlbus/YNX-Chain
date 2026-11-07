# Original account-purpose host

`NativeAccountPurposeChild.cpp` implements the eight original Native functions
declared by Auth's `OriginalAccountPurposeChildPrivate.hpp`.
`NativeAccountProofReader.cpp` implements all eight sole SDK HostPort/Reader
functions. These are actual owning bodies, distinct from the registered-account
mother's v2 eight functions; neither group substitutes for the other.

Acquisition calls P09's zero-selector
`normalnative::acquireOriginalNormalSourceAccount(sameGenuineSource)`. It retains
the original backend and every nonnull Source acquisition before inspecting
either failure. The backend owns the original process-entry capture and
independent image expectations. There is no second capture, Node/App/runtime,
caller descriptor, engine-reference resolver, callback or public registration.

The real child binds P09's private acquisition, borrows its same Source parent
and account channel, and holds its exact Source selection. Productive calls
recheck the held backend, Source/selection, parent and original deadline.
The deadline is attenuated once to monotonic time; reads do not renew it.

The Reader uses only the sole SDK97 codec and SequenceDATA. OPEN has an empty
payload and is selected once. NotReady preserves the Reader and is not latched
as a terminal failure; only an explicit read/current can continue it. A Ready
view is additionally bound to the original owner/chain/minimum height and the
same captured checkpoint/hash. This transport adapter does not replace Core's
actual committed proof verification.

Native accepts a Reader only if the actual owning Reader inventory recognizes
its child/Source association. Release additionally requires that same Reader's
actual closed state. Tokens are monotonic and never reused. Cleanup transport
permits only RETIRE/JOIN/CLOSE, never productive OPEN/read/current. Unknown
sequence/response/close effects retain the original token, pending sequence and
Source debt; they cannot be reset, replayed or re-opened. Expired local transport
limits do not fabricate a remote close acknowledgement.

Physical CLOSED and original failure are separate. In particular, a CLOSED
reply with `failure.present=1, code=0` remains a failure and can still witness
actual Reader closure. The child waits for actual Reader release, then settles
its actual parent borrow and one-use child-drain token. It closes the Source
acquisition and calls its **backend loan's** private
`releaseClosedOriginalAccount(exactAcquisition)` before closing the backend
loan. It does not directly release the acquisition and leave a dangling loan.
Ambiguous release is selected once and retained, not re-entered by join.

`PRIVATE_HEADER_PINS.json` locks the nine Auth/P09/SDK headers. Its immutable P09
cohort is recovered byte-for-byte from the original frozen source packets and
the matching Git original channel. The newer mutable FreshScope worktree is
not an input to this cohort. This original single capture has finite original
Source endpoints; fresh per-Source endpoints require that separate matching
successor and cannot be inferred from these tests.

Android CMake and the iOS pod include these bodies and require the exact private
header cohort plus the original A-owned combined Auth/Core/P09 image. No second
Go archive belongs here. The module CI runs Reader controls and, on macOS, a
separate test-only Go overlay reusing P09's original process/identity harness.
The overlay does not modify the P09 worktree or any production file.

Verification is deliberately separated: Reader PUBLIC-child controls; actual
Native/Auth/P09 process/socket composition with PUBLIC Source/profile; four
Android/iOS target objects; and the existing, separately retained real Core
tests. None is a real Root, account proof Ready, installation, signature or
business-flow claim. The qualified external image profile, actual protected
Source and normal account-runtime driver remain separate original-owner
production/admission requirements.
