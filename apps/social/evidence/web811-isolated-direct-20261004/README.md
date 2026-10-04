# Isolated current-source browser observation, 2026-10-04

Source: 811d96b52f95348d96602f406ffd832ce65026e9.
Tree: 6095cc0bbcea2d61d693ddebf30d4029bdc9e2ae.
Build workspace: /tmp/social-web-source811-20261004.QVQiaz.
Observed URL: http://127.0.0.1:54108/ (local, not public deployment).

The initial archive omitted required src modules and the build failed. That was
an incomplete QA preparation, not a product build regression. The original failure
is retained in preparation-incomplete-input.txt. Adding the original src directory
from the SAME commit made the actual web build exit 0; full-input-build.txt is retained.
No source patch or provider injection was used to obtain this build result.

Actual in-app browser tab 15 was opened against a read-only local static server:
English guest page, Connect wallet chooser, close, reload, then close the own tab.
No wallet choice, eth_requestAccounts, authentication, sign, or transaction occurred.

The header and three YNX Wallet choice images loaded the original 798x420 YNX PNG;
the MetaMask choice loaded the official 156x150 SVG, not the improvised fox.
Header rendered geometry was approximately 45.59x24; wallet image boxes were 48x48
with object-fit contain. logo-metrics.json retains direct DOM measurements.
Original YNX PNG SHA256: df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d.
Official MetaMask SVG SHA256: 163dd1be1558ee648c266f4a533b6e10d40b737f838bbe40739d9637017cd35f.

The chooser closed without a blank tab; reload retained the locked guest state.
Captured warning/error logs were empty in the observation interval only. This is
not a global console0, real-provider, late-provider, Wallet lifecycle, Matrix,
installed-core, production deployment, or whole Social acceptance claim.
Public https://social.ynxweb4.com/ was not replaced by this local QA operation.
