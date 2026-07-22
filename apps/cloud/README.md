# YNX Cloud

YNX Cloud is a standalone Web product over `internal/cloud`. It stores bounded file
objects off-chain, uses content-addressed SHA-256 blobs, and exposes only explicit
YNX identity permissions. It does not claim unlimited storage or production
durability.

Run the local product:

```bash
go run ./apps/cloud/cmd/ynx-cloudd -addr 127.0.0.1:8092 -data tmp/cloud
```

Open `http://127.0.0.1:8092/cloud/`. A configured YNX Wallet verifier is required
for normal sessions. `-dev-wallet` is a loopback-only smoke adapter and is never a
deployment authentication mode.

Checks:

```bash
npm --prefix apps/cloud test
npm --prefix apps/cloud run check
bash apps/cloud/scripts/smoke.sh
```

Client-side encryption is an API boundary: ciphertext may be stored with
`AES-256-GCM` metadata, while the user-held recovery package and key never enter
the service. The default scanner is a bounded policy interface and EICAR guard,
not a production antivirus claim.

Bounded resumable multipart API:

- `POST /api/v1/multipart` initiates an upload with exact final size and SHA-256.
- `PUT /api/v1/multipart/{upload}/parts/{part}` accepts a part with `X-Content-SHA256`.
- `GET /api/v1/multipart/{upload}` resumes from durable part metadata.
- `POST /api/v1/multipart/{upload}/complete` verifies ordered parts and final hash.
- `DELETE /api/v1/multipart/{upload}` cancels the upload.

The current assembly limit is 64 MiB with 8 MiB parts. It is an honest local
control-plane implementation, not provider-native streaming multipart. Objects
may carry typed Dataset, Strategy/Model, Build, Backtest/Experiment, Checkpoint,
Media Source, Document Export, or Audit Archive metadata. Content endpoints use
standard HTTP byte ranges.
