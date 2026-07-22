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
