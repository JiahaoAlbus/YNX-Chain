# Native original report intent persistence

Parent: 65e754d319954cf577875517217db87392afd843.

The native confirmed moment-report submission now saves its exact account,
target, category, detail, evidence hashes and nonce before the backend call,
through the existing SecureStore mechanism. Controller recreation and cold
unknown retry retain the original body/key. A changed pending body is rejected,
not overwritten. An identical completed report retains its original key and
original result ID; a different result is held for recovery. A different draft
after an explicitly completed operation obtains a new nonce only on a new
explicit user invocation. No storage read starts a background report.

The current-view guard and original Report confirmation remain in place.
Read/write/nonce failures and authority loss before dispatch produce no send.
Authority loss after a possibly committed response retains the original pending
data. Invalid stored records remain untouched and are rejected. Request bodies
and evidence arrays are copied before asynchronous work. Stored record IDs are
comparison data, not proof of backend authorization or acceptance.

Project typecheck passed. The 26 related tests passed, including six new cold
report cases, six current-report cases and both existing native-action suites.
The complete npm test invocation passed and actual Android/iOS export passed;
logs/status are retained adjacent. These are source/controller/bundle checks,
not installed device or real backend acceptance.

Remaining whole-product work includes exact installed SecureStore lock/restart,
actual original backend receipt verification, account-data-deletion integration
for local pending report records, controlled recovery UI, native/public source
identity, MONSTER ordinary-user acceptance and all previously open crypto gates.
No real report, account request, signing, transaction, deployment or device
activation was performed. Do not activate/release this candidate merely because
tests and bundles are green.
