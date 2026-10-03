# Export ABA operation retirement

Inherited predecessor: d22c02413e52c454c0e70b010ea708b7374dff73.

Independent audit of b68e51c42 found a stale duplicate export, not a proved authority or cross-user funds attack: displayed owner A -> B -> A with unchanged identity epochs made a retired A response current again.

The new VM regression failed on unchanged source in 1.112166ms: retired A created/clicked/revoked a download before current A completed. It covers late success and error, middle B completion, fresh A coalescing, original cleanup not removing fresh A, and next normal export.

Minimal fix: `current()` additionally requires `ownedExportOperations.get(key)===operation`. Both success and error use this predicate; existing finally already identity-binds map deletion. No authority, endpoint, protocol, identity epoch or receipt change.

Actual Chrome button test now performs B -> A -> B with unchanged epochs for both retired success and error; only fresh B produces a download, exact delivered bytes remain `current ABA bytes`, and repeated fresh clicks coalesce. Original account/context transitions remain covered.

Seven ordinary Finance test groups: 56/56 PASS, zero failures/skips, 13299.324375ms. JavaScript syntax and git diff checks PASS. Independent original audit file/export remains untouched.

Source/local controlled-browser checkpoint only. No public deployment, installed-app, real approval, private session or business execution claim. Formal release remains with A wallet_release_owner; no Shared/Host paths changed.
