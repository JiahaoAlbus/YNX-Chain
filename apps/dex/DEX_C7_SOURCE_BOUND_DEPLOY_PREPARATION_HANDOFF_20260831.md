# DEX c7 source-bound deployment preparation

This is a local, unsigned candidate only. It binds source `c7a96d48f17f9dc70bbdc42389cf1052771ee904` and archive SHA-256 `f5f247e8c9a291d60e36beecbf103fb7f7ebe8b53785a8cc2509f5bf2ed6a506` (3,514,259 bytes). The Linux amd64 indexer is `65d22ea56078cb63db3a88fb6672b6643963f431c7527c6bb7ef50b664f3114d` (6,942,868 bytes). Extraction verified all 16 archive entries against its internal `SHA256SUMS`.

The current public DEX is still `ac775de24176b293b5dbb5ab7114cf29428f8046`, not c7. The old `scripts/dex-public-runtime-release.sh` is intentionally unusable: it hard-rejects any source and archive other than `7563dc…`. Central must first fresh-bind host/runtime/rollback facts and approve a separate c7-specific DEX-only executor. No SSH, deployment, Wallet approval, swap, liquidity action or transaction occurred.
