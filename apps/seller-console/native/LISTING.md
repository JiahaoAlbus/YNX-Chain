# Original Native Seller listing publication

`runListingCLI` borrows the original qualified Seller API, current actor/Source
fence and `createMutationIntents` storage/lock. It opens no account, Source,
Wallet connection, signer, default URL or second journal. A Buyer session cannot
be relabeled as a Seller session. Real Native caller/Source admission and formal
application install remain separate runtime requirements.

- `inspect`: `{StoreID}` and exact `productID`, using existing Seller authority at
  `POST /api/seller/listing/read`. Returns current product/variant DATA only.
- `publish`: entire reviewed `{StoreID,ExpectedRevision,Title,Description,Category,
  Media,Variants}`. Variant fields are `{ID,Name,SKU,PriceYNXT,Inventory}`; new IDs
  may be empty and are generated only by the original Store transaction. Money
  and counts are canonical decimal strings through the complete int64 range.
  No Reserved field, Pay terms, atom conversion or Root/role can be injected.
- `recover`: same original operands. Only `POST /api/seller/mutations/lookup`
  with original method/path/key/body; never another publication or GET-based
  guess that an old publication happened. Changed input/actor/source or an
  unusable response preserves the original UNKNOWN identity.

`POST /api/seller/products/{id}/native-listing` decodes these Native strings and
calls the existing `Store.PublishListing`, which checks current catalog and any
necessary inventory permission, same Store, original product revision and
reservation floors before one price/stock/publication commit. No intermediate
draft or partially published variant set is exposed. The optional Store binding
is omitted from old semantic JSON, so all old listing request hashes remain
byte-identical. Existing order price/quantity snapshots remain frozen.

The Native response reports exact decimal strings and excludes edit-history and
unrelated private data. Original recovery may return a later legitimately edited
or unpublished product: it proves the old original applied and returns current
DATA, without restoring old prices/counts/publication. This is listing activity,
never payment proof, goods receipt or funds authority.

Focused checks cover the unchanged official R9 digest/journal, altered inputs,
late Source and foreign/malformed responses, full int64 roundtrip, actual Native
CLI/HTTP/cold Store original recovery after a later legitimate edit, same-Store
binding, old semantic bytes, atomic publication/persistence failure and the
original fixed Native API Seller refusal path. PUBLIC principal controls are not
real account, Root/Source, installed client, payment or public release acceptance.
