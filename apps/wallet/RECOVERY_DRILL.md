# Wallet recovery drill

The automated recovery drill is `src/storage/walletRepository.test.ts`, test “offline recovery reconstructs only the native account and never restores product sessions.” It executes the security invariant; this document records the operator procedure for a replacement device.

## Preconditions

1. Use a testnet account with a verified offline 64-hex recovery key.
2. Record its native `ynx1` address, connected product sessions, and source-device audit count without copying any secret into the test report.
3. Treat the source device as lost. Do not export its secure-storage database or product device keys.

## Procedure

1. Install a fresh YNX Wallet build on a replacement device and choose **Recover on a replacement device**.
2. Authenticate locally, enter the offline recovery key, and save it into device-only secure storage.
3. Restart the process. Confirm the Wallet starts locked and local authentication is required.
4. Confirm the derived account exactly equals the recorded native `ynx1` address.
5. Confirm Connected Apps and Sessions are empty, old product device keys are absent, authorization audit is empty, and old replay records are absent.
6. Start a fresh canonical sign-in from a reviewed product. Confirm the new product device key differs from the lost device and the exact callback completes only after new approval.
7. Invoke central **all devices logout** for the account and confirm every session issued at/before the logout is rejected. Then create one new post-logout session and verify it is active only on the exact new product device.

## Pass criteria

- Same native `ynx1` account, different device-local session/device state.
- No recovery of old sessions, approvals, device keys, replay tombstones, or audit history.
- Lost-device sessions fail introspection after all-devices logout.
- No private key/recovery material appears in logs, screenshots, callbacks, AI inputs, or evidence files.

## Current evidence and gap

Local repository tests prove steps 2–5 and central lifecycle tests prove step 7 semantics, including restart and tamper rejection. A real cross-device central drill cannot be claimed until the canonical Gateway lifecycle is integrated and deployed; that is a central dependency, not simulated success.
