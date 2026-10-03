# Direct public guest readback, 2026-10-04 Asia/Shanghai

Observed the actual https://social.ynxweb4.com/ entry using one new isolated agent browser tab (12), without replacing providers, fixture authentication or scripted state injection. The entry has English language and shows private-service degradation while retaining guest access.

Actual actions: open the existing standard-wallet chooser only; observe distinct visible YNX Wallet and MetaMask names/logos; close chooser; use the real Explore as guest link; reload the same #experience URL. One related Social tab was observed, guest page remained nonempty, and the bounded captured console error/warning list was empty. A first AX guest-click attempt timed out; current state was inspected before using a successful semantic locator action. This is not evidence that the first click succeeded.

Both wallet rows were enabled in this public UI. Neither was clicked. No provider availability/discovery proof is inferred from the buttons or static logos. No account approval, rejection, chain switch, signing, transaction, private-session grant, message, installation or dot/MONSTER action was performed.

## Runtime/source mismatch

Actual public app.js SHA256: 966a47ae3d285a625ab666ddeca91defa156f04337b700fc07bd6c73e97ee51d (6928 bytes). It differs from owner commit b04a73f0f67ad234f4a0abbcef2eff557a0af753 and older ecffe336/cf27c8ca candidate bytes. Public index.html and wallet-provider.js also differ from b04a73f0f; the two public wallet-logo asset blobs match it. Public responses expose no source/deployment identity. A regional x-vercel-id response/request value is not a deployment identity and is not substituted for one.

These are direct public observations of the presently served bytes, NOT a source-bound current-owner acceptance envelope. New native changes are not proven publicly released. Public marketing text about chat/recovery does not establish actual encrypted delivery.

## Executable handoff

SOCIAL_PUBLIC_RUNTIME_NOT_BOUND_TO_OWNER_SOURCE: The designated release owner must use the already-authorized deployment management route to identify the exact active Social deployment/artifact and its source, compare it to the resource bytes captured here, and select/freeze the intended Social-only source/artifact/rollback under the existing Central single-use release gate. Then the owner can release under that lease and Social can repeat actual non-sensitive public checks. Social cannot infer the deployment ID, invent a source marker, bypass the lease or deploy to close this gate.

Full native private-chat/group/media/Moments, identity continuity/two nodes/recovery, model admission and actual dot/MONSTER gates remain separate and unverified. This checkpoint does not shrink the Social v2 goal to a guest landing page.
