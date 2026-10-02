# Restricted Moments HTTP/UI integration checkpoint

Baseline: 30ae73436cd525a3137b4ed8dab502c426f32890.

## Actual source changes

- The normal Matrix workspace mounts the existing audience HTTP adapter rather
  than leaving resolve/authorize callbacks absent.
- A separate publishing client uses the exact six-scope selection. Its begin
  operation is attached only to the explicit publishing-permissions button;
  opening/refreshing chat does not silently upgrade the five-scope chat grant.
- Resolve bodies contain only kind and, when appropriate, original groupId or
  selected public friend IDs. Caller account is retained only in view guards.
- Review allocates one stable transaction before authority work and supplies
  action=read. Publish and confirmed index retain this original transaction.
- Group/friend selectors load existing authenticated Social contacts and
  conversations endpoints. Only existing group_ identifiers and sp_ public
  friend IDs are offered; Matrix aliases are not user input or derived here.
  The backend remains authoritative for current contacts, group ownership and
  membership. A group appearing in the conversation list is not itself proof
  that the current actor may publish to it.
- HTTP metadata is normalized into the original consumer's typed snapshot
  ordering, avoiding JSON key-order mismatch between resolve and check.

## Local evidence

`src/restrictedMomentsIntegration.test.ts` drives actual UI event handlers,
the unmodified RestrictedMoments consumer and the HTTP adapter. A minimal DOM,
synthetic authority proofs and synthetic Matrix client are explicit fixtures,
not real public/installed/HS evidence. Tests assert strict resolve/authorize
keys, original record selection and the same transaction across read, two
publish policy checks, send and index.

The complete npm suite passed 102/102, zero skips/failures. Typecheck initially
failed because nullable default JS callback arguments were inferred as null;
explicit callback JSDoc fixed this and the final typecheck passed. The original
failure log remains. Esbuild bundled the normal session-ui browser entry
successfully (3.0 MiB). Logs: `moments-ui-http/20261002/`.

## Remaining gates

Production action proof creation and after-await live ProductSession verification
still require approved shared owner A integration; missing APIs/permission or
unavailable HS authority fail visibly without sending. No shared vendor source
was changed. Actual permission approval, browser UI rendering, real service
responses, Group/Selected success across ordinary accounts, encrypted attachment
publication, protected durable drafts, full Native/device lifecycle, public and
installed Social v2 acceptance remain unproved. No deployment, real account
authorization, wallet signing/transaction or real database mutation occurred.

The existing online service is not replaced by this source checkpoint. Source
integration does not satisfy Central's separate deployment or user-flow gates.
