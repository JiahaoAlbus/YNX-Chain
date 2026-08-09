# YNX Music user guide

YNX Music Testnet Preview is a private-by-default player and creator workspace for audio you own or are licensed to use. It does not include commercial recordings, public charts, real listener counts, guaranteed royalties, or production streaming.

## Sign in

1. Open the installed Android or iOS app and choose **Sign in with YNX Wallet**.
2. Wallet shows the product, callback, requested scopes and five-minute expiry. Approve only if they match YNX Music.
3. Music proves possession of its device-bound P-256 key to the Gateway. Recovery material never enters Music.

An expired, replayed, altered, wrong-device, wrong-callback or cross-product response is rejected. The Web preview intentionally does not store a Wallet session.

## Listen and organize

- Home and Search show only releases visible to the signed-in account.
- Track detail exposes artist, album, rights basis, evidence reference, territory, provenance and integrity digest.
- Favorites, queue, playlists, private history, playback position and download state survive restart.
- Android uses a foreground MediaSession with notification/lock controls. iOS uses AVPlayer, AudioSession and RemoteCommandCenter.
- Offline files live in private app storage and are validated as WAV before atomic replacement. Clearing private data removes the session, library cache, position and downloads from the device.

Empty and offline screens are truthful: no catalog record is invented when central services or a network are unavailable.

## Creator Studio

Creator Studio is entered from Settings rather than mixed into listener tabs. Upload only PCM WAV you own or are licensed to use. Title, public creator name, rights basis, territories, evidence and audio provenance are required; artwork provenance is required when artwork is attached.

Uploads begin as private drafts and are excluded from listener catalog queries until explicit release. Takedown, report, dispute and appeal create audited Trust cases. A settlement is only a `requires_wallet_review` Pay intent; it is not paid and is not a royalty receipt.

## AI review

AI can prepare recommendations, playlists, metadata, creator descriptions, discovery and royalty explanations from explicitly selected owned/favorite tracks. The screen shows provider, model, context and estimate. Disconnect cancels streaming. Results must be applied or rejected by the user; AI cannot publish, pay, delete, penalize or change permissions.
