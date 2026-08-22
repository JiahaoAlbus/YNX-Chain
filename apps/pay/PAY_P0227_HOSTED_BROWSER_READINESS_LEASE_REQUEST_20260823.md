# Pay P0-227 Hosted Chromium Readiness Request

P0-226 proved the exact candidate and raw resources were available, but it used the wrong idle-state predicate. `Waiting for Wallet` appears only while an account request is pending; no account request is permitted in this non-sensitive predeploy run. The actual disconnected state is the visible `Sign in` wallet button.

## Frozen successor

- Remote parent: `56ed9a4ba7a7eceae3ac47a78cbb0ede12a73573`
- Workflow implementation: `d490150246275785b5ca544bf2c3bdf19efb490f`
- Tree: `2d9ed653cef5c49d49917fabaa12284aaf7b183d`
- Workflow blob: `90964b1503ba899a86f6801e338a0abd14889722`
- Workflow bytes: `12645`
- Workflow SHA-256: `e2a69af956895d68f21bd8e59ce62a9247d75ad3130e26057ad804fb14f2db2d`
- Required pushed head message: `evidence(pay): capture hosted Chromium readiness`

Before every navigation/load/readiness wait, the workflow writes current DOM, body text, URL, title, language, open pages, console errors, page errors, request failures, response status records, and a screenshot into a newly created isolated runner-temp directory. Failures also capture terminal DOM and screenshot before closing Chromium.

The positive disconnected state is `Sign in`, together with visible `YNX Pay`, `Settings`, the invoice textbox, English readiness copy, and `lang=en`. Negative assertions require no chooser, no connected details, no account, no `0x1917`, one stable page, and zero browser/resource errors. Only `domcontentloaded` and `load` are used. Cold Chromium closes before a second Chromium process opens the same profile.

## Equivalent fixture

The workflow browser block was extracted byte-for-byte and executed against the exact archive at `127.0.0.1:4189`.

- Cold JSON SHA-256: `ea2390e2d65404bd7e0baf40d5d523444bad3593a2a6fc3d4853b4b876c38ed8`
- Second JSON SHA-256: `fd480933d7ffb81b4845c22a5ead33d598de5eb273f10b1cc031ffcb54abcb2a`
- Summary SHA-256: `9703196da3dbf7f1eecd78a226981d66b79ab3f13dcff00b4d6c52901ea5568c`
- Both phases: exact URL/title, English, one page, `Sign in`, console/page/request errors zero, no account, no chain.
- Existing Pay web suite: `2/2 PASS`.

## Requested decision

Issue one wholly new Pay-only path-scoped lease for one force-false push and exactly one push run. No retry, dispatch, secret, input, dynamic URL, SSH, production, provider selection, account request, signature, typed data, or transaction is permitted.

Even a successful P0-227 only qualifies the exact candidate for later consideration under a wholly new rollback-first production lease.
