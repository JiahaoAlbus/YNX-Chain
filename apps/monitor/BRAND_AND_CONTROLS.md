# Monitor brand and control sizing

The language and AI-language controls use 16px text and a 48px minimum height. At widths up to 480px, the login selectors occupy separate rows so the selected language remains readable. Public service details and individual service summaries have a minimum 48px click area. Sign-in inputs and wallet controls also use 16px text.

The icon files are exact copies from `YNX-WEBSITE-BRAND-ICONS-20260906-V2`. The page uses versioned favicon links and a square 44px logo box with `object-fit: contain`. The PWA keeps the Monitor name and start URL while adopting the shared white/Klein-blue icon set. `icon.svg` remains a compatibility alias for the approved embedded-image favicon; its old route remains available to the existing shell cache.

The operations cache guard in `public/sw.js` is unchanged from source `5ff75b2e5dd15928da728f17567a68b16e1801fa`. Publish the complete new distribution, including all PNG, ICO and SVG files. Verify the public ICO response is a real icon, not the SPA HTML fallback.

The public login page offers the reviewed Chrome/Edge f90ad90 ZIP as a direct file download, with visible manual installation steps and test-preview limitations in all twelve languages. Its bundled catalog is the exact public r4c preview metadata (SHA-256 `814574df0d3e8e689d10446ee7358938a1ce407afcee249be1b5ba7d0a964887`). Catalog entries must be explicitly published and download-verified, belong to the reviewed artifact allowlist, and point to the matching immutable HTTPS file. The PWA ZIP is not an online launch or browser extension. No Firefox or unverified macOS link is offered.

Local validation covers all twelve languages at 1440px, 390px and 320px, including collapsed and expanded public service details, Arabic RTL, dark OS preference, workspace language selectors and the download action. Authenticated views use explicitly synthetic local fixtures; this is not public operator-login or wallet-interaction evidence. Download availability does not prove installation, permission upgrades, sign-in, signing, transfers or a browser-store release. Wallet discovery and service authorization remain unchanged.
