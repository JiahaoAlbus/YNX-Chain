# Frozen Social-only prebuilt web deployment carrier

Source commit: e9bf8888c3903e63c8d5207a499060e5a62c466b.
Source tree: e54b5131367f4e2bb9ff8c2ff4242555cd92b110.
Source parent: 27e4b3924d9e68fd8d3fd1df4615d517a7128d38.
Controller: 接续测试网生态审计工作.
Only requested publisher: original A wallet_release_owner; NOT authorized here.

## Exact frozen carrier

social-web-deploy.tgz: 3344070 bytes.
SHA256: 9ebdc1e6a6705ad851e17152292d908ef955c8de20f8cc964da1aee8d06b0f41.
Archive root is the deployment root. vercel.json fixes installCommand=true,
buildCommand=node verify-build.cjs, framework=null and outputDirectory=dist.
No dependency installation/network download or new SDK graph is needed for the
prebuilt-output integrity check. The ACTUAL source web build was executed first
from git archive of the exact source web/src/package files using existing locked
owner dependencies; source-build.txt and source input SHA256s are retained.

artifact-files.json contains 30 exact output/contract paths, byte counts and hashes.
The cold check and a second check after extracting the EXACT compressed carrier
both passed. The verifier refuses missing, altered, duplicate, nonregular/symlink
or unlisted output files and requires the declared build/output contract. A must
verify the EXTERNAL frozen archive SHA/immutable carrier identity before executing
its internal checker; the internal manifest alone is not a trust root.

The candidate public /.well-known/ynx-social-build.json declares the original
source and no new crypto activation. It is only a build declaration. Post-release
proof must compare real HTML/assets to frozen hashes AND perform actual browser
checks, not trust that declaration by itself.

This artifact contract is generated INSIDE owned evidence only. It does not change
A-owned apps/social/vercel.json, shared runtime, project settings, current hosting,
backend, native libraries, identities, accounts, or SDK activation. deploy-root is
local preparation; the committed tgz and exported contract are the durable carrier.

## Fresh current public observations

Anonymous HTTP GET without account credentials captured the current public HTML
and referenced app.js/styles.css. current-public-identity.json retains exact URL,
bytes/hash/status/time. app.js is 6928 bytes, SHA256
966a47ae3d285a625ab666ddeca91defa156f04337b700fc07bd6c73e97ee51d.
styles.css is 6327 bytes, SHA256
1f80ec6b7ab8c2ff0d1d66edf083d301af89386c802483733fd670a5ada26c42.
Cookie/auth header lines are excluded from the retained public-header evidence.
Vercel request IDs are NOT deployment IDs. Current exact deployment/source/rollback
identity remains NOT_VERIFIED; these HTTP asset fingerprints are not browser,
wallet, private-session, Matrix, installed or whole-product evidence.

## Single executable release blocker

Central/A must resolve lease-request.json.centralRequired from the existing Social
project: exact current deployment/artifact, unique executor command/project ID,
exact rollback deployment/artifact and one original rollback procedure, then issue
a SEPARATE single-use Social-only lease for the frozen carrier. Requested lifetime
is 15 minutes from Central issuance, not an invented pre-issued expiry.
Until then NO_GO. Do not deploy or alias this carrier, and do not treat normal
commit/push, local checks or an HTTP200 as completion.

Planned post-release scope is NON-SENSITIVE only: exact source/asset readback,
original YNX header/Wallet logo and official MetaMask identity/logo, English guest,
chooser close, URL/tab/no-blank behavior and interval-scoped console observations.
Late/no-provider checks require the original approved harness, not untrusted page
injection. No eth_requestAccounts, sign, EIP712, send, identity injection or SDK
activation is authorized. Wallet lifecycle, protected producer/checkpoints/restore,
real Matrix/two-node and MONSTER remain open. Whole Social/crypto649 NOT_COMPLETE.
