# Finance Phase3 rollback-first deployment lease request

P0-236 completed only the candidate archive and secret-safe environment preparation. Central independently released it with Finance still on PID 877083 and NRestarts 0. Nothing has been extracted, switched, restarted, or published.

This successor asks Central for one new Finance-only production lease. Before signing, Central must freshly bind the live release, binary, environment metadata without values, unit, Caddy route, state, service and public/loopback bodies. The lease must also bind the exact P0-236 candidate archive and environment receipts.

The requested run is rollback-first and single-use: isolated safe extraction, full candidate inventory verification, exact rollback capture, atomic environment/current switch, one Finance restart, source-bound loopback/public verification, and non-sensitive browser verification of distinct YNX Wallet and MetaMask identity. Any first failure must restore the old environment, state and current target, restart the old service, verify old public identity, and clean only exact lease-owned objects.

No account request, approval, signing, typed data, transaction, private-key operation, unit change, Caddy change, or non-Finance mutation is requested. This document and its JSON companion are requests only and grant no deployment authority.
