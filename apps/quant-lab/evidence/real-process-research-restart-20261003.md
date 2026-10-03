# Quant actual process and browser restart validation

Product-source checkpoint under test:
`a6d8b4092212b619ed26895cf12f3a45cf6d2ff0`.
This successor changes the owned browser test only: require both actual Go
service launches to terminate normally after SIGTERM (code 0, signal null),
bound the shutdown observation to 12 seconds, and emit retained binary identity.

Executed `node --test apps/quant-lab/tests/research-recovery-browser.test.mjs`:
1/1 PASS, 4093.613541ms test / 4332.959958ms total. JS syntax and diff checks PASS.
The test builds the real Go app server, opens local Chrome at 390x844, saves an
actual engine backtest, loses its HTTP response, rejects modified retry inputs,
normally stops/restarts the service, reloads the browser, restores original
inputs and retries with the same request bytes/key. Durable readback contains
one strategy and one experiment, not a duplicate. Arabic locale retry, pending
clear, one tab, no horizontal overflow and no pageerror all pass. Both original
and second process return code 0 after SIGTERM.

Retained QA directory:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-kn2HHr`.
Built local binary: 11466914 bytes; SHA256
`de7d339c3cdbc349e194c3ef0b12c6bfc9e87959072ff0cdc1bccc6328df2363`.
This is a local native QA binary, not an approved public or user installer.

Market tape is explicitly controlled/local; no real market-price, canonical
Wallet authority, Relay, account, signature or transaction proof is asserted.
Storage for this browser case is local filesystem, not multi-instance production
PostgreSQL. Real isolated PostgreSQL cancellation/restart gates remain in their
separate checkpoint. Public/installed/Product Session flags remain false here.
Formal coherent release is still owned by the unique release owner. No Host,
shared authority, formal pins or production state changed.
