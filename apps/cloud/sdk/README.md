# YNX Cloud JavaScript client

`@ynx/cloud-client` is the dependency-free ESM client for the versioned YNX Cloud and YNX Docs API. It accepts a short-lived canonical Wallet product-session callback rather than storing credentials. The service remains authoritative for product binding, scopes, ACLs, hashes, versions, quota, audit, and AI consent.

```js
import { YNXCloudClient } from "@ynx/cloud-client";

const cloud = new YNXCloudClient({
  endpoint: "https://your-reviewed-cloud-host",
  product: "cloud",
  getAccessToken: () => walletSession.currentAccessToken(),
});

const page = await cloud.list({ view: "recent", limit: 100 });
```

The client retries idempotent requests only when the service returns `429` or `503`, honors bounded `Retry-After`, surfaces request/error IDs, and never retries mutating POST requests automatically. It does not create sessions, hold Wallet approvals, upload provider credentials, or weaken server-side authorization.

`eraseProductData()` sends the exact product-bound destructive confirmation once
and requires a Wallet session with the dedicated `data.delete` scope. It returns
the service's hashed-owner receipt and never converts a pending provider deletion
into success. `erasureReceipts()` supports receipt recovery after the erasing
session is revoked and the user explicitly signs in again.

## Client-side encryption candidate

`generateClientSideEncryptionKey`, `encryptClientSideContent`, and
`decryptClientSideContent` provide a dependency-free Web Crypto AES-256-GCM
candidate. The encrypted envelope binds ciphertext to an exact product,
account, caller-generated context ID, and version through authenticated
additional data. Upload the returned `content` bytes and pass the returned
`encryption` metadata to Cloud object, multipart, or direct-upload creation.

The raw key and recovery material remain user-held. YNX Cloud never receives
the key, cannot recover plaintext, and cannot silently change the account,
product, context ID, or version without authentication failure. Callers must
store the key outside the uploaded object and must not place it in `keyHint`,
logs, analytics, URLs, or support tickets.

`createClientSideRecoveryPackage` wraps a content key with a separate 256-bit
recovery key and binds the package to the exact encryption context, generation,
and recovery-policy identifier. `recoverClientSideEncryptionKey` rejects stale
generations, wrong accounts/products/objects/versions, policy mismatches,
tampered packages, and wrong recovery keys. The recovery key must be held in an
OS keystore, hardware-backed store, or offline recovery system outside Cloud.

`rotateClientSideEncryptedContent` decrypts and re-encrypts in memory using a
new key and strictly increasing context version. It returns no partial output
when authentication or encryption fails. Applications still need a durable
two-phase client workflow around upload/commit and must keep the previous key
until the new ciphertext, recovery package, and remote version are verified.
