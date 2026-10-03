# Exact isolated dependency composition results

Social source tested: 9b6844d8e43a224c67f1786041b0251c3d13c14b.
Read-only shared production namespace: internal/productsessionv2 at
c5e4178bb548baa05f552e8e1bc0f566ddc6f72d from its original shared owner repository.

The missing declarations were located in registered_clients.go and
revalidation.go. The original committed namespace was exported using git
archive into an isolated temporary directory. A Go overlay mapped that exact
production namespace for this test build only. No owner/shared source file was
modified and no original Social test was deleted, excluded or replaced. Files
absent from the exact shared production snapshot were absent only in that
virtual namespace, not removed from either worktree.

Actual commands and results:

```sh
go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -run 'TestMomentDeleteLostResponseColdRetryPreservesOriginalTombstone|TestMomentBusinessCurrentReaderUnavailableLeavesOriginalState' -count=1 -race
# exit 0
go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -count=1 -race
# exit 0, 16.662s
```

The committed shared-productsession-source-c5e4178.tar.gz is the exact git
archive, 63895 bytes. Its SHA is recorded in shared-source-SHA256SUMS.txt.
It is a durable reproduction input, not a deployed or approved shared product.
shared-overlay.json records the original owner and temporary composition paths;
reproduction must regenerate those paths for the new extraction directory.
shared-composition-status.txt and both shared test logs retain real outcomes.
The original missing-declaration failure remains in tests.txt and is not erased.

These results close this candidate's NOT_RUN regression in the exact isolated
dependency composition only. They do not integrate or admit the shared source
into the owner branch, approve its provider candidate, prove production Product
Session authority, or close actual install/public/user acceptance. Root/shared
owner still coordinates the exact dependency integration. No device, account,
signing, transaction, deployment or crypto activation occurred.
