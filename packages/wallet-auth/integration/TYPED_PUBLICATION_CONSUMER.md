# Original typed publication consumer

Auth15 includes the frozen R167 carrier and R170 constructor in the same
normal source inventory. Auth14 remains immutable. Use the existing Node-only
`@ynx-chain/wallet-auth/original-ide-admission` export through the same SDK root
as the original peer and request-owner consumers.

The Native calls are:

```text
captureOriginalIDEPublicationArtifact(canonicalManifest, ordinaryUint8Array)
readOriginalIDEPublicationArtifactManifest(actualTaggedArtifactRef)
closeOriginalIDEPublicationArtifact(actualTaggedArtifactRef)
acquireOriginalIDEProtectedPublicationKeyCall(actualEntryURL, canonicalManifest, actualTaggedArtifactRef)
```

The artifact is immutable DATA, bounded to 64 MiB with a separate canonical
manifest bounded to 16 KiB. It is not a Source, publisher, review, approval,
proof or signing permission. Native validates the actual same-environment tag,
canonical bytes, content size and hash; a JavaScript type does not establish
those facts. No path, file descriptor, provider or alternate module is accepted.

Capture precedes review. Retain and close the caller's artifact reference in its
own lifecycle. The constructor captures an independent strong immutable artifact
reference before acquiring Source/effect custody, so closing the caller reference
does not discard the constructor's data. Changed manifest or artifact bytes need
a new visible review; never repair an old request or replay an uncertain effect.

Adopt the returned original request owner before calling any readiness, proof or
current method. It may be a cleanup partial. The SDK returns that exact owner
without asserting, invoking, retrying or closing it. Preserve its first cause
and UNKNOWN custody; drain an effect before its parent Source. The constructor
uses only the dedicated Native typed-publication selector, without legacy fallback.

The original Main owner must supply the genuine current publisher, protected
store, explicit review and approval, and once-only signing effect. Auth still
owns the CurrentProject/Publisher and original proof producer. A captured artifact,
hash, Relay nine-field scope, old login or legacy session cannot substitute for
any of these. Do not register user Keychain material in the privileged helper.

The complete successor requires a new same-package runtime union, independent
Source release rows, platform admission and A's matching full App. No source-test
addon is a product artifact. Source/package/CI success does not prove installed
login, persisted session recovery, revocation, signature or publication.
