# Exact libsodium 1.0.22 dependency and attachment checkpoint

Owner source parent: 086f664bf515e861d2918cba60dacc9bd1fee625.
Original attachment implementation is unchanged by this checkpoint.

Fixed point release, not LATEST or moving stable:
https://download.libsodium.org/libsodium/releases/libsodium-1.0.22.tar.gz
SHA256 adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349.
The original .minisig is retained. Official Minisign 0.12 source commit
b85e15d45ac9eab34e44596fd309f5b07db9545c was built in isolation against the
existing 1.0.20 library only as the verification tool. Its source archive SHA
is c0ed356116aa63d95abd37d1843fdae7373aeab8197fadd8625bc7f989ac15bd.

The libsodium source package was verified before extraction/build with the
official documented public Ed25519 distribution verification key:
RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3.
Actual verifier output confirms both signature and trusted comment signature.
The verification tool's own source was acquired over official HTTPS at the
fixed commit; this is not an independent local GPG verification of its tag or
an audited reproducible verification-tool bootstrap.

Official references:
https://doc.libsodium.org/installation
https://github.com/jedisct1/libsodium/releases/tag/1.0.22
https://github.com/jedisct1/minisign/releases/tag/0.12

Build was static, entirely in a new temporary directory, with no system install.
The actual header and statically linked runtime both report 1.0.22. The unchanged
Veil attachment check was explicitly linked against that new static library,
not pkg-config's global 1.0.20: 20 checks passed. Only the owned C adapter/check
was ASAN/UBSAN instrumented; the libsodium crypto library was built normally.
The upstream make check exit is separately recorded in status.txt and its log.

The dependency package/signature, verification source, logs, probe, selected
local static library/check binary and hashes are durable evidence artifacts,
not formally distributed platform libraries or activated crypto. Test keys
are ephemeral synthetic fixtures; no account or user keys were collected.

This closes only the prior selected-library mismatch for this local attachment
check. It does not prove device trusted keys, attachment wire/AAD/key admission,
JNI/Swift/Windows ports, protected state/anchor, Matrix upload/download budgets,
PQXDH/SPQR/group/backup/history, real installed/public lifecycle or MONSTER.
No production source dependency was swapped, platform release installed,
account/signature/transaction requested, deployment or crypto activation done.
