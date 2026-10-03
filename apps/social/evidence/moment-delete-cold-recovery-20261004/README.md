# Exact original delete recovery checkpoint

Parent consumer: fce5d2528ec4c65ccc25331b12deb37c71f31031.

DeleteMoment previously returned ErrNotFound for every tombstone, including the
current original author after a committed delete with a lost response. The
native durable original action could therefore never confirm its exact retry.
The repair allows only the original author, after existing current product
authority and write-availability guards, to confirm the retained tombstone.
There is no second write, audit, notification, nonce protocol or removal.
Different authors still receive ErrNotFound for tombstones; unknown objects and
stale authorization do not become success.

The new regression covers actual Social signed state save/cold decode,
unchanged original tombstone/audit on retry, missing objects, different author
and revoked current actor. Authority remains the existing synthetic test port.
No real identity or installed/native lifecycle is implied.

Actual go build ./internal/social passed. The targeted race test command DID
NOT EXECUTE tests: existing social_combined_http_test.go and
moments_current_test.go require absent shared productsessionv2 declarations
RegisteredClientSet, NewPrivateBusinessRevalidator, NewRegisteredClientSet and
Revalidator in this owner branch. Exact compiler errors are retained in
tests.txt. Tests were not deleted, excluded, replaced or suppressed.

Executable internal dependency action: sole controller coordinates the shared
owner's exact admitted Product Session revalidator source/dependency tuple into
this owner composition, then reruns the original targeted command with race.
Until that is available, the new behavioral regression is NOT_RUN and this
repair is an unadmitted source checkpoint, not completion or deployment.
