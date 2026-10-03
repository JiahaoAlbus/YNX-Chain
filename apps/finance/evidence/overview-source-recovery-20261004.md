# Finance complete overview source recovery

Predecessor: 2afe57660f0412bb5569b5c8d4c6d4cfa583241c. Ordinary owner scope only. No shared Wallet/Auth/SSO/permission/endpoint-authority or Host change.

The actual complete render path dereferenced portfolio.explorerStatus.available before reaching the already-hardened receipt/planning/support functions. Controlled installed Chrome reproduced TypeError on null source metadata. The second baseline case also showed that invalid envelope/privacy data had no typed rejection before changing displayed values. Isolated child-renderer tests therefore did not prove whole-page recovery.

The complete overview now validates its object envelope, nonempty account label and existing three boolean privacy fields before DOM updates. The existing Go Privacy JSON contract in internal/finance/types.go emits all three booleans without omitempty; validation does not invent a new API or coerce omitted/string values to false. The owned loader validates before storing overview, marking data ready or reconciling its owner. Invalid data remains unavailable/non-writable; explicit fresh read can recover. This is a UI response-consistency guard, not a new identity/permission authority or proof that a returned account was genuinely authorized.

Explorer/Pay availability requires exact object available=true. Null, missing, arrays, string true and numeric 1 cannot assert a live source. They show unavailable values while readable owned planning records still render. Exact returned zero with available=true remains 0 YNXT. Alerts distinguish missing source from a real empty array and retain valid neighboring rows when others are malformed, instead of throwing or claiming no alerts.

Executed final gates:

- Whole-overview installed Chrome: 3/3 passed, including malformed source metadata, valid neighbors, unsafe help destination exclusion, real zero/source recovery, typed pre-DOM privacy rejection and loader invalid->explicit-fresh-valid recovery. No network request, extra tab, navigation, account or authorization was used.
- Combined overview/read-controller/save-controller/save-browser/read-sources suite: 37/37 passed (36981.277 ms). Existing stale pre-save read, next draft, native-owner draft isolation, privacy single-flight and export handling remain checked.
- Targeted actual Chrome planning fixture: 1/1 passed (1308.539083 ms). The old rendering-only privacy={} fixture and label-only overview fixtures were corrected to the real pre-existing boolean/envelope schema and now exercise the actual validator; the production guard was not bypassed to make old synthetic fixtures pass.
- node --check on product app and new test, git diff --check passed.
- Initial baseline failures and intermediate fixture failures were retained in tool output. They were resolved by correcting the production boundary and its test dependencies, not hidden by skipping checks.

Release-owner integration: preserve current shared graph and apply only the ordinary helper plus the overview/alerts/loader hunks. The earlier immutable three-range renderer capsule remains unchanged and independently reusable. When integrating against the older 17d2d6dd graph, do not copy the whole latest render line: that would additionally introduce unrelated draft helpers from newer owner source. Instead add validateFinanceOverview before the existing renderer's DOM mutation, add the same check before accepting its existing overview read, and replace only source availability reads with exact boolean/object checks; use the hardened alerts body. Preserve existing owner-specific calls and declarations. Then run the merged whole-page tests and normal final asset pin/build/release process. This owner did not update protected final release pins or deploy.

Public complete owner source, real private Finance account read/save, Wallet approval/callback, native installation, capital execution and full goal remain unproved. No request for account, signature or transaction occurred.
