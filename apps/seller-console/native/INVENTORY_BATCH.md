# Original Seller inventory batch CLI

The independent `shopd --native-api` fixed `shop-api.ynxweb4.com` surface now
mounts `POST /api/seller/inventory/batch`, the original Seller mutation lookup,
and `POST /api/seller/inventory/read` through its original complete Seller handler.
It keeps that handler's existing identity, current Source, action proof and
membership checks. An absent/denied Seller never falls through to Buyer, a
legacy bearer, a Web page or a replacement Source. The remaining Seller Web
surface is unchanged.

The batch accepts 1–100 distinct SKU updates in one existing Store:

```json
{
  "StoreID": "store_original",
  "IdempotencyKey": "original-inventory-key",
  "Items": [
    {"ProductID":"product_one","VariantID":"v1","ExpectedRevision":"7","Inventory":"21"},
    {"ProductID":"product_two","VariantID":"v2","ExpectedRevision":"9","Inventory":"31"}
  ]
}
```

All counts and revisions are canonical nonnegative decimal strings, bounded
by int64. Revisions refer to the original product version and must agree for
all of that product's variants. The current inventory role is required.
Store ownership, every version, unique SKU, reservation floor and revision
overflow are checked before changing any product. Each product increments its
revision once. All products, the original idempotency record, audit and current
V2 proof admission commit in the same existing Store transaction. A stale last
SKU, revoked context or failed persistence cannot publish a partial batch.

The bounded response contains `StoreID`, `RequestHash`, `OriginalApplied`,
`QueryOnly`, and the selected `Products[{ID,StoreID,Revision,Variants}]` with
`Variants[{ID,Inventory,Reserved}]`. Revisions/counts remain decimal strings in
both directions. No prices, order, goods receipt, settlement or refund proof
is created by this inventory operation.

Replaying the exact original key/body only returns current selected inventory;
it never reapplies old absolute counts. Cold recovery uses the existing
`POST /api/seller/mutations/lookup` with
`{Method:"POST",Path:"/seller/inventory/batch",OriginalBody:"<exact original JSON>"}`.
The original record must match the complete request hash and Store. Current
role permission is checked again. `OriginalApplied=true` proves that the
original batch was admitted, while the returned counts are current DATA and
can differ after another legitimate edit. Missing/changed records or resources
remain unresolved, with no automatic new batch.

`runInventoryBatchCLI` is the Native/CLI command consumer. `command:"inspect"`
reads `{StoreID,Items:[{ProductID,VariantID}]}` through the fixed inventory read
endpoint. It returns the precise current revision/count strings, has no
`OriginalApplied` field and needs no mutation journal. It does not permit query
aliases or select another Store's data without the original current role.

The original protected Seller runtime calls `command:"apply"|"recover"` with the body
above without an idempotency key, and its existing `account`, `current`, `api`
and `createMutationIntents` instance. `api(path,{method,body,beforeDispatch})`
is the existing authenticated product request callee; it calls `beforeDispatch`
at its actual transport boundary. Boot retains its original durable opaque
identity store and lock. The command supplies no endpoint, key, grant, Source
factory or storage substitute. Recovery needs the same original operands.
An invalid/rebound reply cannot clear UNKNOWN or rotate the original key.

The original CI bundles the CLI against the unchanged SHA-pinned R9 archive,
runs its command/recovery checks and connects it to the actual Shop HTTP
handler and durable Store in two separate CLI processes. That controlled
integration drops the first response, reopens the service Store, makes an
independent inventory edit and verifies lookup does not overwrite it. The
integration driver's nonce, account/context, local JSON store and HTTP ports
are explicitly PUBLIC test fixtures. This proves product behavior, not real
Source commissioning, installed Seller authorization, payment or deployment.
