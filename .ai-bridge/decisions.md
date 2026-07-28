# YNX Creator Studio — Decisions

Updated: 2026-07-27T15:47:21Z

1. Creator Studio remains a Web-first independent product. Viewer, listener and Social experiences remain outside this product surface.
2. Channel ownership is canonical. Team roles may operate within bounded permissions, but uploaded media, revenue records and payout ownership remain attached to the channel owner.
3. Team accounts and contributor split accounts must decode as canonical YNX Wallet addresses. Free-form identities are rejected.
4. Role administration is owner-only. `owner` cannot be delegated. Role change or revocation increments `Channel.AuthVersion`; requests re-evaluate persisted membership and fail closed.
5. Public or unlisted publication requires an active rights declaration bound to the exact uploaded SHA-256. Commercial eligibility and revenue require independent verified rights.
6. Rights review is a global moderation boundary. The declarer and channel owner cannot self-verify. Creator Studio does not expose a creator-side rights review control.
7. Expired, rejected or lineage-mismatched rights remove audience access immediately. Rejection also returns the video to private/ready recovery state.
8. Finance role may inspect revenue and submit a dispute, but cannot create a payout intent for itself. Payout destination authority remains the canonical owner Wallet flow.
9. State updates are copy-on-write transactions. HMAC verification occurs before schema normalization; failed mutations or failed disk replacement do not change authoritative in-memory state.
10. Existing Video registry/App Gateway files are integration candidates, not central acceptance evidence. Creator Studio publishes a separate owner contract rather than rewriting another owner's integration truth.
11. No mock scanner, fake revenue, fake audience, self-issued Wallet session or static success may satisfy Testnet/Public gates.
12. This evidence slice may describe protected source commit `192da88b0ca3897278893711fb08e1373b0562b2`; the later evidence commit is not retroactively described as runtime source evidence.
