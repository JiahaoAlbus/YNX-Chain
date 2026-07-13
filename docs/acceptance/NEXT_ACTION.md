# Next Action

Current single action: verify the separate YNX website repository and its Vercel production binding, then integrate the live YNX Testnet status through real public APIs. This is the largest locally actionable ecosystem gap now that release `c9324fbfc464` is live and both SDKs pass public read-only proof. Public BFT remains higher strategic priority but cannot proceed without offline recovery, owner handover, rotation evidence, and an independent custody review. AI generation proof also remains externally blocked by provider HTTP `429 insufficient_quota`.

Required work:

- Confirm `/Users/huangjiahao/Desktop/YNX-Chain-website` is the intended repository, branch, and Vercel production source before changing or deploying it.
- Inspect the rendered production site and current data paths; replace synthetic or stale chain state with `https://rpc.ynxweb4.com`, `https://evm.ynxweb4.com`, and the real Explorer where appropriate.
- Preserve truthful testnet language: no mainnet, exchange listing, stablecoin issuer support, wallet default support, partnership, or public BFT claim.
- Keep website code in the website repository. Update chain acceptance files only after live production verification.
- Apply the requested Apple-inspired interaction quality only where it does not hide operational state, testnet boundaries, errors, or data provenance.

Files to touch:

- `/Users/huangjiahao/Desktop/YNX-Chain-website` frontend, configuration, tests, and deployment metadata as required by its existing architecture.
- Chain acceptance state only after live production verification; do not place website runtime code in the chain repository.

Validation commands:

- Run the website repository's existing lint, typecheck, tests, and production build.
- Verify desktop and mobile rendering, live height growth, correct chain ID `6423` / `0x1917`, native `YNXT`, API failure states, zero horizontal overflow, and no browser console errors.
- Deploy through the confirmed Vercel production project, then repeat checks against the production URL.
- Re-run `make sdk-remote-check`, `make no-placeholder-check`, `make secret-scan`, and `make objective-state-check` in the chain repository before recording completion.

Completion standard:

- The intended Vercel production project serves the intended `main` branch.
- Production website data is backed by live YNX public endpoints and visibly distinguishes testnet/current state from goals.
- Local screenshots or a successful Vercel build alone do not count; the deployed URL must be verified.

Explicitly not doing:

- No new EVM opcodes, Counter behavior, Hardhat artifacts, arbitrary IDE execution, or unrelated Explorer expansion.
- No signer upload, public freeze, authoritative pause, candidate/dependency start, ingress switch, or BFT cutover without the required independent custody approval.
- Do not modify or replace the long-term goal file.
