# Social / Cloud attachment runtime contract

This document describes the runnable source configuration, not an observed
production deployment. Central owns the actual service replacement and TLS map.

## Social daemon

- Build: `go build -o /approved/artifacts/ynx-sociald ./cmd/ynx-sociald`.
- Entry: `ynx-sociald -http 127.0.0.1:6491 -state-dir /existing/social/state`.
- The listen address shown is the source default, not a live-host observation.
- Preserve the existing state directory and `YNX_SOCIAL_TOKEN_KEY` unchanged.
- `YNX_SOCIAL_TOKEN_KEY`: existing hex-encoded key, minimum 32 decoded bytes.
- `YNX_SOCIAL_INTERNAL_API_KEY`: existing server-only Chat/Square service key.
- `YNX_SOCIAL_CLOUD_AUTHORITY_TOKEN`: new dedicated server-only machine secret,
  at least 32 characters. Absence leaves Cloud registry/mint/authority disabled.
- `-check-config` validates environment without starting or writing state.
- Persistent files: `social.json`, `chat.json`, `square.json`; the new sidecar is
  `social.json.cloud-objects.json`, signed using a domain-separated MAC derived
  from the existing Social token key. Keep it with Social state backups.
- Capabilities are in-memory, bounded to 4096 and at most 90 seconds. Restart
  invalidates capabilities, not object ownership records or uploaded ciphertext.

## Routes and TLS

- Client registry: `POST /social/v1/cloud-objects`.
- Client mint: `POST /social/v1/cloud-objects/{objectId}/capability`.
- Machine callback: `POST /internal/cloud-objects/authorize`.
- Cloud's `YNX_SOCIAL_AUTHORITY_URL` must be a real approved HTTPS origin whose
  `/internal/cloud-objects/authorize` route proxies to Social's private listener.
- Cloud rejects plain HTTP even on localhost. Central must supply the TLS
  termination/CA-trust mapping; this source does not silently downgrade TLS.
- Cloud's `YNX_SOCIAL_AUTHORITY_TOKEN` equals Social's dedicated machine secret.
  Never put either token in an EXPO_PUBLIC variable, bundle or client request.

## Native client

- Approved target `EXPO_PUBLIC_YNX_SOCIAL_CLOUD_BASE=https://web4.ynxweb4.com`.
- Client appends `/api/v1/social-attachments`; Central maps this to Cloud 6496.
- The target is configuration, not evidence that the old deployment supports it.
- Pending ciphertext is a private app document file; attachment key and metadata
  remain in SecureStore until the exact encrypted message is durably enqueued.
- An authenticated Social session and active matching chat device are still
  required. New Wallet registry scopes do not migrate old Bearer sessions.

## Local cross-service test

Run `bash apps/social/scripts/test-cloud-contract.sh /path/to/cloud-owner
65c11414f6627d187c2fe8ea3e894e1d852595ba` from the Social repository.
The test uses real TLS Social callbacks and Cloud HTTP with synthetic test
sessions/ciphertext. It is not installed-device or public user-flow acceptance.
