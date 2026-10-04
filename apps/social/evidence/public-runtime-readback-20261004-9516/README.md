# Direct non-sensitive public runtime readback

Evidence recorded: 2026-10-04 around 05:00 UTC.
Owner product-source checkpoint: 9516b07448f3ae58d3f5633350622c33e2533055.
Controller: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.
Actual public URL: https://social.ynxweb4.com/.

This is a real public browser observation, not a local React host, fixture page,
CI receipt or proof that the owner checkpoint is deployed.

## Observed public behavior

- English guest page loaded. Private-service degradation was explicitly displayed.
- Top Connect wallet opened the actual same-page chooser. No wallet was selected.
- YNX Wallet and MetaMask were separately named, with their own image elements.
- The actual chooser still displays the old improvised blue Y mark and fox artwork,
  not the frozen candidate's original YNX PNG/official MetaMask asset.
- Live chooser assets are ./assets/ynx-wallet.svg and ./assets/metamask.svg,
  both reported intrinsic 150 x 150. Source and dimensions are retained as JSON.
- Observed browser tab inventory was [18] before and after opening the chooser.
  Its URL remained https://social.ynxweb4.com/. No blank/new tab appeared in this
  observed interaction. This is not an all-platform/lifecycle guarantee.
- Close dismissed the chooser and restored the actual guest page.
- Captured browser warn/error messages for this interval were empty.

Original screenshots and AX records are retained. Only our created tab 18 was
closed. No existing user tab, emulator, installed app, account or wallet was altered.

## Source-bound release still NOT_VERIFIED

Public app.js SHA256:
966a47ae3d285a625ab666ddeca91defa156f04337b700fc07bd6c73e97ee51d.
It equals the earlier observed old public application fingerprint. Anonymous GET
of /.well-known/ynx-social-build.json returned HTTP 404, unlike the exact frozen
candidate's declared build-identity output. No current exact Vercel deployment ID,
deployed source commit or rollback identity is inferred from those facts.

The observed application click handler was inspected before opening the chooser:
the top/hero button displays a modal; selection buttons are separate actions.
We did not click selection/install, request accounts, approve/reject permissions,
switch/add a chain, sign, send, inject providers, revoke permissions or create a
Product Session. Existing connectivity and private identities are NOT_VERIFIED.

## One executable public-release blocker

Original Central/A publisher must bind the existing Social project/current exact
deployment and rollback, then issue and execute the separate single-use Social
release lease for the already-frozen aa975 web candidate (source e9bf8888c), not
borrow a Website or device lease. Exact existing carrier:
3344070 bytes, SHA256
9ebdc1e6a6705ad851e17152292d908ef955c8de20f8cc964da1aee8d06b0f41.
Its lease request already records the missing original project/executor/current
deployment/rollback inputs. Do not publish from this diagnostic evidence folder.

Until that original runtime handoff exists, the correct public logos and exact
candidate source binding remain NO_GO. Publishing that web candidate would not
by itself deploy the later native/contact source or complete Social/crypto649.
Source-matching admitted installation, actual protected native/private flows and
the human-designated MONSTER's executable validation channel remain separate gates.
No deployment, installation, new grant or crypto activation was performed here.
