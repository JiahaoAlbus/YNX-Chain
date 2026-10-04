# Matrix callback VM bootstrap qualification

The inherited actual HTML bootstrap assertion failed under plain Node because vm.Script dynamic imports require --experimental-vm-modules. The same unchanged HTML and original assertions passed with that runtime flag. Production callback HTML, callback entry/login logic, builder, CSP and the frozen UI artifact were not changed.

Only test environment changes: run the three actual bootstrap fixtures in a child using the same Node executable with its VM module flag, anchored exact test names and TAP output. Preserve every original assertion; require child success and exactly one passed target. Clear the parent's internal NODE_TEST_CONTEXT so the child is a real standalone runner. The first parent-state isolation failure is retained separately, not overwritten.

Plain command: node --test web/matrix/login-callback.test.mjs
Result: 18 passed, 0 failed, 0 skipped. The callback-only test also builds its original two owned modules without SDK/vendor/WASM. This is synthetic VM/build evidence, not real authenticated callback acceptance.

Main owner separately opened the actual public https://social.ynxweb4.com/matrix/login/callback with no query, fragment or credential. It retained branding, a safe unavailable/expired retry, exact return URL, no-referrer, and no captured console warnings/errors. No account/login/sign/transaction was requested. The screenshot and readback are retained here. This does not prove actual token delivery or private authority.

Supersedes the unclassified Matrix VM regression noted in the historical candidate manifest/handoff. The frozen site.tar.gz remains 3571918 bytes, SHA256 6e36fc80400ab5c8ce9fbbbab582913ef814f32fd5c7abd1587bd1c9578fe43d, source b9b046c9662fa20cdf07f7aa169b2b71af54d02a. No product artifact rebuild is needed for this test-only qualification. Formal publisher still owns fresh alias/project/deployment/config/source/rollback binding and release. Whole Social v2, crypto649, installed/native/private journeys and real MONSTER acceptance remain open.
