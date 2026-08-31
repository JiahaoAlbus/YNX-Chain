# YNX Data Fabric TypeScript SDK

This package is the supported Node.js TypeScript client for Canonical Event
Envelope v1/v2 producers and consumers. It mirrors the Go SDK's fail-closed
transport boundaries:

- remote endpoints require HTTPS; loopback HTTP is allowed for local tests;
- producers verify the event HMAC before delivery and bind every request body
  to a separate producer-delivery HMAC;
- application API calls obtain short-lived canonical Wallet/App Gateway
  credentials through a caller-supplied provider;
- responses are size-bounded and reject unknown or missing fields;
- an accepted event receipt means committed to the Transactional Outbox, not
  completion of downstream business effects or network exactly-once delivery.

The SDK never accepts or stores Wallet private keys, seeds, PAN/CVV, or
long-lived bearer credentials. The credential provider must acquire its values
from the canonical Product Session boundary.

```ts
import { DataFabricClient } from "@ynx/data-fabric";

const client = new DataFabricClient(process.env.YNX_DATA_FABRIC_URL!, {
  async credentials(binding) {
    return canonicalGateway.authorize(binding);
  },
});

const page = await client.events();
```

Build and test with `npm test`. Published artifacts must be produced only by
the source-bound release process after central acceptance.
