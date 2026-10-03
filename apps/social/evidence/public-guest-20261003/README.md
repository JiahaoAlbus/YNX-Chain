# Actual public guest observation

Observed origin: https://social.ynxweb4.com/
Owner source checkpoint: 93fabd77a048be27575d94ce4529f1087da40d5d.
Observation timestamp, actual loaded resource bytes/SHA, resource tree and
captured console entries are in observed-assets.json. Snapshots and chooser.jpg
were captured from the real in-app browser, not a local fixture or mock provider.

Observed: English guest page, no blank guest screen, distinct YNX Wallet and
MetaMask names/logo resources in a same-tab chooser, Close returns to guest,
guest refresh remains at the canonical URL. Captured error/warning entries were
empty at the observation time; this is not comprehensive network or provider
request instrumentation. No wallet option, permission, account, sign or tx
control was activated. No deployment occurred.

Actual loaded public bytes:
- HTML: 6098 bytes, SHA256 783f835245b9acbb4cbfe29cb56faa55243d593858c80692d39034e97e42a05b
- app.js: 6928 bytes, SHA256 966a47ae3d285a625ab666ddeca91defa156f04337b700fc07bd6c73e97ee51d
- wallet-provider.js: 7749 bytes, SHA256 d8df8193407f835ff16913417acca0db2ae1f091defc16e0b29a98996ffdea75

Owner checkpoint hashes differ:
- apps/social/web/index.html: eb52969f39a0ff3f98f6e7e878b5ac5d0e93bfcac830ec68d02c92ecde42711a
- apps/social/web/app.js: 5423cde5dd89aa89b9dd2c032d942702816c4baefeb8c9a58964f7e331a4ec72
- apps/social/web/wallet-provider.js: 6cfcf13b2cebb3e8de876e5f3387cf4e0717ac246288d3c8c4a40fbff50ff1c3

This proves these loaded bytes differ from the owner source files, not which
deployment commit or whole release produced them. releaseSourceCommit is null;
no immutable deployment ID or corresponding complete release source binding was
visible. Router/full Social source-bound public E2E remains NOT_VERIFIED.

The loaded app hardcodes its private-service-degraded banner. That banner is not
evidence of actual TLS, backend health or a tested degraded-session lifecycle.
Displayed preview copy is not a real authenticated product flow. Distinct visual
assets are not installed provider rdns/identity evidence or brand provenance.

Not performed: account approval/rejection, 0x1917 switch/add/readback, connected
refresh or provider events, revoke, late/no-provider behavior, first-party private
return, Uniswap/OpenSea/Safe, sign/EIP712/send, WalletConnect relay, installed
Matrix/device/contacts/moments/federation. No injected mock wallet was used.

Executable dependency: A must bind the intended complete integrated release to
an immutable artifact/deployment and obtain Central's separate single-use lease
before deployment. Then perform source-bound non-sensitive verification first;
sensitive stages require immediate user confirmation. Central NO_GO is unchanged.
