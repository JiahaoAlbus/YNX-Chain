# Independent contact read timestamps

Base: 87a845d77ed198aedd3404732c8a8794df2b48e2.

contactRequestAt copied its record but returned mutable ExpiresAt/ClosedAt pointers into original data. A source caller modifying a view could change the original deadline or terminal timestamp. This is a Go-level source alias, not a claim of an HTTP attack or changed permissions.

Original tests reproduced two failures in original-tests.txt. The expired-view test initially compared against a deadline variable aliased to the same pointer, masking that case. Capturing an independent immutable expected value corrected the fixture; original-tests-corrected-fixture.txt reproduces all three failures against unchanged original production source. Both histories are retained, with no deleted test or weakened assertion.

The helper now copies both original timestamp values and gives a derived expired view an independent terminal timestamp. Expiry boundary, original pending/accepted statuses, UpdatedAt, legacy missing deadlines, actual acceptance mutation paths, friendship, following and audience authorization remain unchanged. No persisted row migration or rewrite is added.

Actual full go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -count=1 -race exit0,15.304s, including original Social tests and the three view regressions. Overlay is the exact original read-only shared c5e4178bb548baa05f552e8e1bc0f566ddc6f72d namespace with durable reproduction in ../moment-delete-cold-recovery-20261004/; no shared source included.

This closes only these reproduced source cases pending independent review. Actual users, installed/public protected producers, complete normal UI and crypto649 are not proven. Unknown original artifacts and earlier FAIL/HOLD evidence remain preserved.
