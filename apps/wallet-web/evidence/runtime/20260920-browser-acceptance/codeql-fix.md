# CodeQL fixture follow-up

Removed the HTML script-extraction regular expression from runtime-evidence.test.js. The test now checks the exact repository fixture wrapper and slices its controlled JavaScript; this helper is explicitly not an HTML parser or sanitizer. Both lowercase script and uppercase SCRIPT wrappers execute the real provider regression. Unexpected wrappers are rejected.

Validation: focused 12/12; Wallet Web full 353/353. No production, manifest, browser gate or artifact changes. Commands: `node --test test/runtime-evidence.test.js test/runtime-harness.test.js test/runtime-extension-gates.test.js`; `npm test`, from apps/wallet-web.
