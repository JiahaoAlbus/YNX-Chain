# Card standard SDK development checkpoint

The source uses the exact Wallet Owner c97f85e9 standalone browser artifact for
both YNX Wallet and MetaMask. The existing Card reducer and guest/registration
screens remain in place. No native installer was rebuilt or installed.

Covered locally: late EIP-6963 discovery, injected-provider ambiguity, distinct
YNX/MetaMask identity, read-only restore, provider events, exact error 4001,
switch/add/readback of chain 0x1917, SDK revocation plus account readback, and
continued independence from optional private services. All wallet responses in
these tests are fixtures. No real account-access request, signature, or transfer
was performed.

The 28 focused tests and combined client/server typecheck passed in attempt-01.
Build results and raw log digests are recorded separately in build-01. This
workspace also contains an uncommitted backend development slice. These runs
are local development evidence, not clean-clone, installed-device, public
deployment, full lifecycle, or final integration acceptance evidence.

Still false: real wallet approval/rejection, installed refresh/disconnect,
Product Session migration, backend business approval, ACTIVE card creation,
real YNXT funding, real-world card/payment capability, public release, and
Computer Control. The public alias was not mutated by this work.

Backend follow-up is intentionally separate: consume the Wallet Owner's Card
application approval verifier and route-specific scopes; never treat a login
scope, a synthetic funding event, or address-format conversion as an approval.
