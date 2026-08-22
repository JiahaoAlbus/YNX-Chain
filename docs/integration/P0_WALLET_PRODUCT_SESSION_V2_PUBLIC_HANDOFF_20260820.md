# P0 Wallet Product Session v2 public handoff — 2026-08-20

Wallet/Auth source `6cf3ef845202bd879ed94515a71b323dd2fc9e14` is active at `https://wallet-auth.ynxweb4.com` under Central single-use lease `P0-WALLET-CONNECTIVITY-2026-08-wallet-auth-v2-runtime-artifact-lease-v7-20260820T132601Z` from Central commit `c34c37ebe686cdf6a74fa1dacca62261f3d2ffa1`.

The controlled rollback drill started the candidate, proved registered Social v1 and Finance v2 CORS plus attacker rejection, restored exact source `49e30d999e9a9cbdd2c565021009f2cab0dc125c`, and retained shared legacy-v1 SHA-256 `ba386fb9e474ea0886c2e41184db7fac3fcf6aea6dd02f5fe47122a62d3a8c9e`. Final activation then used a fresh stopped-service copy inside the unchanged exact `ReadWritePaths=/var/lib/ynx-wallet-gateway` root.

The public acceptance ran through the official HTTPS domain and passed challenge, complete, introspect, real systemd restart and re-introspection, replay rejection, revoke, post-revoke rejection, device revoke and post-device-revoke rejection. Wrong origin, CORS header, method, route and query failed closed. The five v2 routes were exercised. Exact request IDs and HTTP/Bytes/SHA facts are in `release/integration/wallet-product-session-v2-public-deployment-evidence.json`.

Caddy files and the base systemd unit are byte-identical to their pre-deploy backup. The only live systemd addition is the reviewed environment-only candidate drop-in. Shared legacy v1, candidate v1 and candidate v2 use three distinct mode-0600, nlink-1 files; the candidate directory is ubuntu-owned mode-0700 and is not a symlink.

The accepted record is now published on the official Website. Authoritative Website commit `a7313313014bb8792f38e649e9f556dbee983c8c` contains the runtime record. The latest observed Vercel production deployment `dpl_3DuzTMQFt9GbLPp3Vt1t3D2gfQyx` is `READY`; both `https://ynxweb4.com` and `https://www.ynxweb4.com` return the same `/docs` and runtime-record bytes. The Vercel deployment URL itself is access-protected, so direct content verification for that URL remains false; official-origin content verification is true.

Truth boundaries remain strict. Product migration is `0/12`; no installed Wallet approval, account, signing, transaction, Chain-disconnect Retry, public expiry, production signing, store release or aggregate completion is claimed. `integratedCentral=false` remains unchanged. Computer Use could not capture the visible page because the Mac was locked and automatic unlock failed, so `computerControlVisibleFlowVerified=false`.
