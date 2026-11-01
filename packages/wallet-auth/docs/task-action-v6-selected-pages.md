# Task V6 selected-page body matching successor

Same unpublished matching V6 grammar; no new signature domain, route, certificate purpose, request/header fields or Source authority. The seven-key run body remains accepted unchanged. `task.run-start` and `task.run-resume` additionally accept exactly eight keys, adding only `selectedPages` to `{runId,taskRevision,generation,prompt,resume,authorizationRef,toolIds}`. `toolIds` remains required by this SDK. `selectedPages` is an ordered array of 0..16 exact `{selectionId,version}` records. `selectionId` is nonempty strict UTF8, <=128 bytes; no Unicode normalization. `version` is the original snapshot SHA512: exactly 128 lowercase hexadecimal characters. Duplicate selection IDs, even with differing versions, fail. No aliases, URL/content, approval or Source flags are accepted.

`inspectProductSessionTaskSelectedPagesV6DATA(actualBytes,unsigned)` captures actual original bytes and reuses the production body validator, checking task revision, generation, run ID and resume. The independently signed request path contains task ID. It projects immutable refs and exact body digest/length; `null` means legacy seven keys and `[]` means explicitly zero selections. The native Source DATA contract exposes the same function as `inspectOriginalAITaskActionV6SelectedPagesRequestDATA`. This is not Browser Source admission or a selected-page approval. Original AI mobile identity stays ios/android, not Browser macOS.

Original raw body bytes, including whitespace and uint64 numeric tokens, are not reserialized. SHA256(raw body) and raw length remain in the 35-field canonical unsigned request. The existing E5 message remains `[domain,u32(6),network32,canonicalOwner,canonicalUnsignedJSON]`. Thus signatures and the requestDigest (SHA256(E5), not header/member/body alone) cover actual selection IDs/versions as well as task/run/revision/generation. Changing any page version requires a different body digest and signed message; old proof fails. No new public signer is introduced.

The finite references match frozen P08 b831 `TaskPageReference` / `validateTaskPageReferences` and its actual `taskRunRequest`. Test-only Go declarations are copied verbatim with provenance pins; the Go reader's 32KiB HTTP body/request budget is separate from the existing SDK 1MiB body cap. This successor does not increase either budget or silently shrink the old seven-key SDK grammar. Go may omit toolIds/selectedPages and accepts JSON null for its slice; this SDK deliberately keeps toolIds mandatory and selectedPages absent-or-array, not null. Original b831 native reader additionally binds actual authenticated session/account/device holder, task, run, authorization reference and selected references, performs Source current checks, and requests the registered Browser producer. Those actual owner checks are not replaced by this DATA projection.

Remaining real gates: P05 protected native endpoint normal loader/Root qualification and P08 `ReadOriginalBrowserPageReadout` actual protected implementation; Auth current/registered approval, egress/model disclosure remain independently required. No code here creates Source, Root, Native admission, current, page getter, model authorization or business receipt. UNKNOWN and original operation/nonce are unchanged. `task.handoff` remains unregistered. General Source verifier/registry, exports, package and workflows are parent-owned and unmodified.

Run only new groups:

```
node --test test/task-action-v6-selected-pages.test.mjs
node --test test/task-action-v6-selected-pages-go.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --module NodeNext --moduleResolution NodeNext --target ES2023 test/task-action-v6-selected-pages.types.mts
```

The Go interoperability test invokes installed `go` (or build-tool-only `GO_BINARY`) without changing Go module/sums. New PUBLIC vectors contain ephemeral test signatures, never Root or production keys. No old math/Source/603 matrix runs are needed.
