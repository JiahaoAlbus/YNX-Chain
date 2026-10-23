# Native IDE cleanup regression

Run `node packages/wallet-auth/native/tests/ide-close-order/run.mjs` on macOS.
The runner extracts the current production cleanup functions and compiles them
with strict warnings, public effect/Source dependencies and a real local socket.
It runs eight request-owner and five Node cleanup controls without SDK installs,
keys, network services or system registration.

These are the original Auth R140 fixtures. The socket helpers are the original
R138 fixture helpers. R140 supplier handoff SHA-256:
`ec780ddef3021e46b24cf4cba0f1c4f897be8095bcc63892518ceb2c1739748e`.
Supplier production leaves are preserved byte for byte:

- request owner: `dc3e4178d032c52c9238abf885716a0d23802377739e8a4e5155c89befe785ca`
- Node owner: `ab91b89a5d31b34116b7243c2b52002555ac7649d154a76e917307c2614f9dc7`

Passing these controls does not establish helper installation, a complete Native
module, original Source admission, or successful receive/recover/keyCall effects.
This source successor requires a future coherent package and Native build;
existing SDK330 and IDE27ad artifacts retain their original identities.
