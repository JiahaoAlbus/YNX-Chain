# Original stable device identity for read-only queries

The existing `@ynx-chain/wallet-auth/original-device-create-intent` module adds:

* `createOriginalDeviceIdentityDATA(input)` accepts exactly networkId,
  canonicalOwner, account, productId, clientId, platform, applicationId,
  bundleId, packageId, origin, callback, deviceId.
* `inspectOriginalDeviceIdentityDATA(originalIdentityBytes, applicationBinding)`
  accepts original canonical UTF8 bytes plus the independent exact productId,
  clientId, platform, applicationId, bundleId, packageId, origin, callback tuple.

Both validate the original account/owner relationship and registered application
tuple. The identity bytes remain the original eight-field canonical object:
version, domain, networkId, canonicalOwner, account, productId, clientId, deviceId.
The domain remains `YNX-PRODUCT-DEVICE-IDENTITY/v1`; the same helper is used by
creation and cold query, retaining existing preimages and dual hashes.

The application tuple is validated separately; it does not add fields to the
stable identity. Generation, operation, nonce, expiry and creation terms cannot
change the stable slot. Query DATA has no nativeIntentDATA and all approval,
Source, Native and current verification flags remain false. Auth's independent
read-only query Source owns its current window and original-result authority.
This API does not select a new operation, generate a key, sign, restore a device
or authorize any replay of an UNKNOWN operation.
