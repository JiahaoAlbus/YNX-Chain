# Fixed normal Nym proof upstream

`proof-resource.mjs` implements the existing normal Nym proof interface. It does not
start Nym, deploy a public service, create TLS certificates, enroll identities or
qualify a browser route. `NYM-PROOF-RESOURCE-CONTRACT.json` in P05 evidence retains
the distinct full-window two-origin synthetic fixture contract.

The original resource owner must supply a reviewed HTTPS DNS origin, generated
public body file of 1...4096 bytes, its exact lowercase SHA-256, a fresh private0700
receipt directory and a lifetime of 1...600 seconds. There are no body/origin/hash
defaults. An existing legitimately authorized HTTPS termination can forward only
the exact path to this owned loopback listener, preserving `Host` without a port:

```text
node apps/browser/privacy-routing/nym/proof-resource.mjs \
  --origin EXACT_REVIEWED_CANONICAL_HTTPS_ORIGIN \
  --body-file /absolute/reviewed-public-bytes.bin \
  --response-sha256 EXACT_REVIEWED_LOWERCASE_SHA256 \
  --receipt /absolute/fresh-private-directory/proof-receipt.json \
  --lifetime-seconds 300
```

The command emits its actual127.0.0.1 ephemeral endpoint. It accepts GET/HEAD only
at `/ynx-route-probe/<[a-z0-9-]{1,40}>/proof`, returns the same pinned bytes for each
fresh runID, rejects query strings, credentials/cookies, body-bearing requests,
wrong Host and other paths/methods. HEAD returns representation headers without
body bytes. RunIDs are public correlation strings, not an authentication allowlist:
if the resource owner publishes this endpoint, anyone who knows the origin and
uses a legal runID can read the same explicitly public synthetic bytes. No private
body or privileged operation belongs here. The normal callee generates a fresh
lowercase UUID before constructing this path; the handler also supports the exact
validator's bounded lower-case runID syntax. It never falls through to another
handler after expiry, budget exhaustion or a rejected path; it sends its own final
HTTP status. A host application must mount this as a terminal proof-prefix route.
This is intentionally the **normal** provider interface: the scoped
synthetic child uses `?probe=baseline-https` and the original dynamic nonce fixture,
which this server refuses. No redirects, user files, exit-IP response or challenge
handling are implemented. Receipt records contain synthetic runID/method/byte/hash
correlation only; rejected arbitrary targets and client addresses are not stored.

At most128 requests are handled (rejected traffic also consumes budget). Expiry,
SIGINT or SIGTERM closes only this listener/connections and writes its own final
receipt; an existing receipt is never overwritten. A stopped handler returns410.
The resource controller must retain the original process handle and collect its
exit. The receipt explicitly keeps `normalTLSValidated=false` and
`platformIsolationAdmitted=false`: loopback HTTP and a matching hash do not prove
external HTTPS, Tor/Nym traversal, full-window no-leak or signed NE qualification.

Parent package inputs `--nym-proof-origin` and `--nym-proof-response-sha256` must
use the same real reviewed origin/hash, only in Nym Route Info before signing.
Domain/TLS/deployment approval, actual normal-TLS200 body-match, client signing/NE,
and whole-window qualification remain separate gates. No fifth Cloudflare tunnel
or website UI change is authorized by this module.

Run only this module's new local delta (no DNS/public requests, GUI or vendor):

```text
YNX_NYM_RESOURCE_TEST_OUTPUT=/absolute/owned-existing-test-output \
  node --test apps/browser/privacy-routing/nym/proof-resource.test.mjs
```

All requests in the tests use numeric127.0.0.1 and explicit synthetic Host headers.
The test file is discovered by the existing `node --test` test entry. No sample
origin/body is installed into a product or resource configuration.
