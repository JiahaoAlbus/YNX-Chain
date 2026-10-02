# Restricted media download successor

Parent source: bc11dd501a85141c7e0469318953cb36e32af2c6.
Status: owned source and isolated QA only. No deployment or installed acceptance.

## Actual consumer path

The normal session UI supplies its original captureView/guardView and identity checks to the mounted feed download callback. The callback uses RestrictedMoments.downloadAttachment, which retains copies of the original index and encrypted descriptor, reads the actual authenticated indexed event, compares its descriptor, and uses the existing transport and locked matrix-encrypt-attachment SDK to decrypt. Current original audience and view checks surround asynchronous results and run again before returning bytes.

The feed renders an explicit same-tab download button, not a plaintext preview. It creates a Blob only after guarded success, immediately revokes its object URL after download initiation, and zeroes its returned byte buffer. Lock, revoke, stale view, or failed verification cannot create a late Blob. No comment intent, transaction, protected outbox, or delivery status is changed by downloading.

## Media transport restrictions

- Derive the media endpoint with the locked Matrix JS SDK, then require the exact authenticated media download path for the original MXC on the already verified homeserver origin.
- Send the Matrix bearer only to that endpoint. Omit browser credentials and referrer; disable redirects in both URL and fetch. Arbitrary origin, route, media substitution, userinfo, and token query fail before fetch.
- Read a bounded response stream with a 25 MiB ceiling rather than unbounded arrayBuffer. Validate optional declared/descriptor lengths and reject empty results.
- Revalidate after fetch, every stream read, and mature SDK decrypt. Abort pending downloads on transport stop and use a bounded network deadline.
- Keep decrypt/hash verification in the existing SDK. No encryption algorithm or credential is invented here.

This deliberate no-redirect policy rejects redirected/CDN media rather than forwarding credentials or silently relaxing the trust boundary. It is a product security policy, not a claim that Matrix prohibits redirects. The authenticated endpoint is defined in https://spec.matrix.org/latest/client-server-api/#get_matrixclientv1mediadownloadservernamemediaid.

## Fresh evidence

- transport-indexed-consumer.json: 21 cases using actual owned transport and indexed consumer, real locked SDK/WebCrypto, Response streams, valid optional-info descriptors, damaged hashes, unsafe credentials destinations, redirects, bounds, revocation, account changes, and stop.
- mounted-feed-download.json: 8 isolated browser cases. The actual mounted button initiates a real browser download whose saved bytes equal the original SDK-encrypted fixture; negative cases produce no Blob. URL/tab stability and console/page errors are checked.
- original-read-probe.json: unchanged independent read probe rerun against this source.
- original-feed-vault-dom.json and original-independent-feed.json: existing feed/protected intent/browser guards rerun without altering assertions.
- typecheck.txt, consumers-test.txt, normal-entry-bundle.txt: normal owned checks, 111 existing consumer tests, and ordinary entry bundle. Not release builds.

SHA256SUMS binds evidence bytes. SOURCE_BLOBS.txt binds changed production/test source. The enclosing commit is the immutable carrier. No output contains a production access token, private wallet key, or real Matrix identity credential.

## Remaining full-goal gates

The session/client/authority fixtures are controlled software QA, not actual live login, HS/RP, existing-MXID mapping, cross-node acceptance, or source-bound public/installed lifecycle. Real HS transport readiness remains unverified. Full unknown/unindexed durable receipt settlement, remaining Social v2 goals, and all original real acceptance requirements remain active. No unknown delivery is auto-retried or treated as confirmed by this work.

Only writer1-owned Social files are changed. No shared SDK/vendor, writer2 vercel.json, production Host configuration, account authorization, signature, transaction, or deployment is performed. Deployment remains solely A under Central controls; coordination remains 接续测试网生态审计工作.
