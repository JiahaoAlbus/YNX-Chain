# Video / Creator SDK529 final candidate handoff

Frozen 2026-09-06T09:53:04.582Z. Owner /root/creator_wallet_closure; coordinator /root. Runtime source **489bf23ac56fb11c5b2ed869fb2a93c2465d2b24**, tree **bc4295590683727d2538b54255ff2ac71ce5c9c9**. Normal push and exact remote branch readback succeeded. Branch codex/audit-video-usability-20260906. This is a release candidate handoff, not installed/product completion.

## Source and behavior

Complete packages/wallet-auth is exactly529471f3822d2bac43ea47a1ab8004fa2ae79885, all171 files and Git tree726f45aa1a66709cfd9711012c6166780a0399be. The complete171-file package plus its read-only migration matrix archive is1679360bytes SHA68a4d192c2a7d82d1ea3f69fe6fe6e7d9c670ce7e4ca29b06fea0341ca4e0e18. No Wallet source-tree edits; no partial SDK copy. esbuild0.28.1 rebuilt both products from that archive and its exact npm lockfile. Same delivered SDK119091bytes SHA723a2740aca03411580d1cb394d1d99fde8e3a021bae1135ee1890751f2aae5f. Public Auth minimum is8dad0bab8f6f711e6ca6037201eec5725f9a6a02; final executor checks the actual /version build.sourceCommit and /time, not the legacy WorkingDirectory declaration alone.

Viewer clears its private library, comments draft and playlist picker as soon as sign-out is clicked, blocks new sign-in during pending logout, and discards late restore/private responses across account changes. Public guest catalog loading stays independent. Creator now preserves stored pending logout through reload and shows explicit Retry sign out. Both wrappers carry the SDK pending state back through preparation failure, so an initial-restore/sign-in race cannot hide the only usable retry control. Existing Creator private/AI/form clearing and async guards remain.

No IndexedDB deletion, key export, device regeneration workaround, state backup restoration or pending-record clearing is used. SDK controls original :revoke/:completion/:return/session retention and conditional cleanup.

## Four frozen, reproducible packages

Local files: /Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/continuation-01a075bd/video-creator-sdk529-final
Remote upload and verification files: /var/tmp/video-creator-sdk529-489bf23ac

| Product / mode | Bytes | SHA-256 |
| --- | ---: | --- |
| creator normal | 77138 | fb73102c29e50a7542d5a09197603c15594b0969aa26f91019c2c9208e269a44 |
| creator compatible-recovery | 41644 | 22bebcfa2470c03e54e093b6c692e4522926e242abaaab0379f2b33a1b436f50 |
| viewer normal | 74404 | 1df1e8019e537de3692f7d815fff34f8e275285121d7a76fed766d105ec51929 |
| viewer compatible-recovery | 41622 | bf999364c413bb94b7ee71d894079954f3a2536919d97da9e864d2d084e02820 |

Archive basenames: ynx-creator-489bf23ac-normal.tar.gz, ynx-creator-489bf23ac-recovery.tar.gz, ynx-viewer-489bf23ac-normal.tar.gz, ynx-viewer-489bf23ac-recovery.tar.gz. Each archive was independently rebuilt byte-identically. d485 preliminary packages and old91bad/b6af/evidence remain preserved; they are not the requested deployment target.

## Verification and current public truth

- Complete frozen SDK suite321/321; delivered minified SDK/gateway/recovery suite62/62. Two additional real-WebCrypto/structured-cloned-IDB fixtures run the independent recovery controller on pending logout and lost completion states. Initial page construction makes zero SDK/storage/Auth calls; explicit offline retry preserves the complete original protected string values byte-for-byte and the same nonextractable device key. Explicit successful retry has no challenge/complete/introspect call and no new device generation.
- Creator18/18 and Viewer85/85 product checks; exact12-locale/22-key catalog and RTL checks. These are source/controller fixtures, not full12-language rendered UX approval. Older isolated legacy rollback fixtures remain historical tests only and do not authorize using old executors.
- Both normal and recovery archives actually unpacked and started under local Node26.7.0/macOS and primary /usr/bin/node22.23.1/Linux. Normal Creator18 and Viewer23 public files including manifest match; each recovery9 public files match. Registered callbacks and no-store match; recovery denies normal app/callback modules and direct private actions. No real approval, signature, user data mutation or native device was used.
- Final executor5 lifecycle fixtures plus9 actual child-process SIGTERM/SIGHUP/SIGINT deliveries during stop, after writing the new drop-in and during start passed locally and on Linux. Runtime failure moves to compatible recovery; if recovery also fails, selected frontend is stopped while the compatible guard remains. Signals during recovery are ignored until the safe outcome is reached. SIGKILL, kernel crash and machine power loss cannot be caught; the last written override is retained, and no automatic rollback removes it.
- Primary stage+verify materialized the immutable four release directories, verified old public runtime bytes/drop-ins and new package bytes, checked current service PID/socket/cwd/argv and unchanged peer/config/environment. It intentionally creates candidate directories; it is not described as read-only. It did not stop/restart/change any service, current symlink, Caddy, API/Auth, environment or live state. At stage completion Creator remainedb6af PID2229608 and Viewer91bad PID2237571. A new version does not inherit their installed success.

Final receipts: local-artifact-http.json, linux-artifact-http.json, reproducibility.json, remote-stage.log and linux-deploy-fixtures.log in this directory. SDK and consumer full logs are one directory above. Source-only/fixture tests do not establish installedWalletApprovalVerified, privateBusinessVerified or browserUIVerified for489bf; all remainfalse until fresh root/Wallet observations.

## Coordinator-only deployment

Frozen executor deploy-sdk529.py SHA**01ba8bd9af63f321812e932edb171abf1229ce18da92fc5b4097b2ac04120019**.
Frozen envelope deploy-envelope.json SHA**9c9a7e1629ffe9403738c46fe64cb67735633595a49dff6ea5f31e2cd7a68cb1**. The exact envelope is also committed at apps/video/audit/sdk529-deploy-envelope.json.

Execute each product separately on primary, Creator first:

```sh
sudo python3 /var/tmp/video-creator-sdk529-489bf23ac/deploy-sdk529.py /var/tmp/video-creator-sdk529-489bf23ac/deploy-envelope.json 9c9a7e1629ffe9403738c46fe64cb67735633595a49dff6ea5f31e2cd7a68cb1 creator deploy --archive-root /var/tmp/video-creator-sdk529-489bf23ac
sudo python3 /var/tmp/video-creator-sdk529-489bf23ac/deploy-sdk529.py /var/tmp/video-creator-sdk529-489bf23ac/deploy-envelope.json 9c9a7e1629ffe9403738c46fe64cb67735633595a49dff6ea5f31e2cd7a68cb1 viewer deploy --archive-root /var/tmp/video-creator-sdk529-489bf23ac
```

The only persistent service mutation is /etc/systemd/system/<selected-unit>.d/20260906-zz-sdk529.conf; old drop-ins are retained and hash-checked. Selected frontend alone is stopped/started; environment, API/current, Auth, other frontend and Caddy identities are checked around the switch. The entrypoint and all normal or recovery files are verified from the exact envelope before activation. Receipts are server-local under /var/lib/ynx-product-frontend-releases/<source>-<product>/, with0700 directory/0600 files.

If the normal candidate fails, the executor automatically attempts its independent recovery package. Manual compatible recovery uses the same command with action recover. Restoring the same repaired normal489bf package uses action resume, retaining the compatible override. Future repaired source needs its own exact reviewed envelope. Do not remove the guard, run old deploy-wallet-time-20260906.sh/deploy-guest-navigation-20260906.sh rollback, reinstall ff68 or restore old browser/Auth state.

## Independent recovery contract

The recovery archive has its own Node server, HTML, CSS, controller, product registration and exact529 SDK file. It imports no normal product app, wrapper or callback. Opening root or a Wallet callback returns visible recovery HTML with HTTP503, Retry-After300, no-store, X-YNX-Mode compatible-recovery and exact X-YNX-Source. Assets/manifest return200 with no-store and those identity headers. The callback is not consumed automatically. No new login link or private business UI is available. Only clicking Retry sign-out initializes the existing same-origin SDK and calls disconnect; a failed or unresolved logout remains pending for another explicit attempt. After repair, reload the same canonical URL once root resumes normal service.

Caddy's /video/api/* bypasses the frontend and still goes to6493. Recovery closes admission in new product pages and direct recovery-server routes; it does not revoke existing sessions in already-open tabs or disable backend APIs globally. Auth8dad remains responsible for their proof/revocation checks. That retained backend behavior is intentional and explicitly outside this frontend switch; no claim of global maintenance isolation is made.

## After deployment

Use the uploaded verify-sdk529-public.mjs with product, envelope and output path. It verifies actual HTTPS normal manifest SHA, every public file, callback, no-store and exact SDK and retains installed/UI/private businessfalse. Example:

```sh
/usr/bin/node /var/tmp/video-creator-sdk529-489bf23ac/verify-sdk529-public.mjs creator /var/tmp/video-creator-sdk529-489bf23ac/deploy-envelope.json /var/tmp/video-creator-sdk529-489bf23ac/creator-public.json
/usr/bin/node /var/tmp/video-creator-sdk529-489bf23ac/verify-sdk529-public.mjs viewer /var/tmp/video-creator-sdk529-489bf23ac/deploy-envelope.json /var/tmp/video-creator-sdk529-489bf23ac/viewer-public.json
```

Wallet/root must newly verify b0 installed approval/return, refresh/private business, immediate sign-out UI, response-loss/reload/explicit retry, denied revoked session, account switch and cross-product isolation on489bf; no inheritedb6af success. Browser playback and full responsive/12-language/accessibility QA, Creator publication/rights/revenue/AI business closure, other installed platforms and store-signed packages remain open. This slice does not reduce the full product requirements.
