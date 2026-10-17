# Finance Broker Sandbox order approval v1

This integration lets YNX Finance Web ask YNX Wallet to sign one exact whole-share limit order for YNX Testnet and the Alpaca Broker Sandbox. Wallet never contacts Alpaca, submits an order, promises a fill, maps a broker account, or marks an approval consumed.

The frozen contract inputs are:

- contract: `f236823ba32a892c4157745490d2ff2767dcc33928b4d4b9dbbbfb8e0dc334f3`
- approval schema: `c3e61e2e7808985041164132b797862a79715ef08e837d26ddb7e9048356d067`
- transport schema: `f45c7ab4c28ce6f01ba7043358cb3e43ed4523990f19754c2ed59777d4ecbc52`
- vectors: `f8f4810e699400f019c33d045088401507d37b8d694e4e9b65498f817e895a5a`

The only launch route is `ynxwallet://finance-order-approval?request=<canonical-base64url>`. The only return target is the registered Finance Web callback at `https://finance.ynxweb4.com/wallet-auth/callback`. Caller-provided callback URLs are not part of the request.

Wallet binds the proof to `com.ynxweb4.finance.web`, `https://finance.ynxweb4.com`, chain `0x1917`, `testnet`, `sandbox`, `alpaca_broker`, the exact Wallet account and public key, the derived Finance subject, broker account UUID, request correlation, and every order field. Decimal amounts use fixed integer arithmetic; trailing-zero and exponent variants are rejected rather than rounded.

Wallet obtains fresh verified Auth time before review and again around signing; device wall time is not an approval authority. It persists a replay reservation before signing and reads the exact record back before returning a result. All Finance journal access is serialized across adapter wrappers in the Wallet process. A storage result that cannot be confirmed quarantines the Finance journal until restart. Lock, background, account switch, expiry, or closing the review cancels outstanding key access. A failed callback can only retry the exact persisted URL and never signs again.

`approved` carries the signed exact order proof. `rejected` carries only `USER_REJECTED`. `revoked` carries a separate Wallet signature over the prior approval digest. If delivery of `approved` was completely lost, Finance verifies the revocation against its own authenticated unsigned challenge, including the derived account and public key, request ID, exact unsigned approval digest, and validity window; it never trusts context reported by the revocation. Revocation is a request for Finance to reject an approval that is still unused; it is not evidence that the proof was unconsumed or that revocation won a race with Finance consumption. Finance owns its account mapping, journal, atomic consume, and broker execution.

The shared deterministic positive vector is `testdata/finance-order-approval-v1.vectors.json`. The protocol and transport tests cover exact vector reproduction, low-S signatures, source and environment binding, fixed callbacks, malformed shapes, canonical encodings, amount arithmetic, time limits, replay correlation, lifecycle cancellation, uncertain storage, callback recovery, and signed unused-proof revocation.
