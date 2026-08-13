# DEX public UI pre-reconnect evidence — 2026-08-13

These screenshots capture the already-public DEX before the explicit global
YNX Chain reconnect control was deployed. They are retained as pre-change
evidence rather than presented as the final UI.

| Viewport | File | SHA-256 | Observation |
| --- | --- | --- | --- |
| 1440×900 | `desktop-current-public-1440x900.png` | `ecb000e8449e98b1f238cbdec46e1748e0810650f5e42ca7be51fd6e7579947a` | Initial API state remained unavailable during the first capture; a separate timed probe reached indexed block data after about eight seconds. |
| 390×844 | `mobile-current-public-390x844.png` | `e030ebd404e9a559b38a6a9cf333a2b6c729caf7ce80c715bfbd11e1001d2cb4` | Indexed data loaded with no horizontal overflow. |

The requested ComputerControl inspection was attempted first through the local
Computer Use skill, but the native Sky pipe failed to start. Playwright was
used only as an automated visual fallback. This limitation is a tooling gap,
not a claim that ComputerControl inspection passed.
