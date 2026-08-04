package chain

import "testing"

func TestReplicationSnapshotCapacityCoversBoundedPublicHistory(t *testing.T) {
	const currentPublicSnapshotBytes = 147_256_060
	if MaxReplicationSnapshotBytes < currentPublicSnapshotBytes {
		t.Fatalf("replication snapshot budget %d is below observed compact public state %d", MaxReplicationSnapshotBytes, currentPublicSnapshotBytes)
	}
	if MaxReplicationSnapshotBytes != 256<<20 {
		t.Fatalf("replication snapshot budget changed without updating the bounded capacity policy: %d", MaxReplicationSnapshotBytes)
	}
}
