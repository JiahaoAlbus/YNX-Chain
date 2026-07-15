# YNX Video service

This package is the persistent orchestration service for YNX Video and Creator
Studio. It writes atomic JSON state and bounded media objects beneath
`YNX_VIDEO_DATA`, fails closed when its malware scanner is unavailable, and uses
FFmpeg to create HLS output. Interrupted scanning/transcoding work is marked
failed and retryable on restart rather than silently published.

Run the daemon with environment-only secrets:

```sh
YNX_VIDEO_DATA=/var/lib/ynx-video \
YNX_VIDEO_SESSIONS='opaque-session=ynx1account' \
YNX_VIDEO_SCANNER=clamdscan \
YNX_VIDEO_FFMPEG=ffmpeg \
YNX_VIDEO_MODERATORS=ynx1reviewer \
go run ./internal/video/cmd
```

`YNX_VIDEO_SESSIONS` is a bounded integration adapter until the Wallet/Auth
branch supplies the reviewed session verifier; it contains opaque product
sessions, never Wallet private keys. Optional `YNX_VIDEO_AI_GATEWAY` plus
`YNX_VIDEO_AI_TOKEN`, and `YNX_VIDEO_PAY_ENDPOINT` plus `YNX_VIDEO_PAY_TOKEN`,
enable the server-side integrations. Absence is reported as unavailable.
