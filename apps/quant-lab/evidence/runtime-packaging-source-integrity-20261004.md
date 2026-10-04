# Quant runtime source integrity

Owner-only packaging correction; no shared Wallet/Auth rebuild and no server mutation.

The inherited packager rebuilt wallet-auth.js with esbuild, followed symlinks via stat, recursively included unrelated web source files and overwrote output archives. It now preserves tracked reviewed bundle bytes, uses an explicit seven-file runtime inventory, validates source Git bytes, rejects symlinks, requires clean unchanged HEAD before and after build, and writes the archive with exclusive creation.

The initial asset test also exposed an inherited i18n.js cache pin mismatch: HTML referenced f8ff2d755c5f77984c8024632bdb572056014cf7b0fafac6c89330e3b9e39cca while tracked i18n.js is 566597c67d136d66aac35a323a9e8070cc743a0f3d02b121ddb22d31af66f900. Only the HTML pin was corrected; translations were not rewritten. Display preferences and the branded PNG are now hash-bound and included.

Executed: runtime-assets plus business-flow tests, 151/151 PASS; packager syntax PASS; versioned assets PASS (six dependencies); git diff --check PASS. Negative tests cover modified/missing dependencies, duplicate and unknown assets.

Public deployment, installed runtime, real account approval, signing and transactions remain NOT_VERIFIED. A built archive is an engineering runtime candidate, not a user installer or completion proof.
