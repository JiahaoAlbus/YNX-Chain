package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func policySnapshotForTest(t *testing.T, d *Devnet) devnetSnapshot {
	t.Helper()
	d.mu.RLock()
	defer d.mu.RUnlock()
	s, err := sealDevnetSnapshot(d.snapshotLocked())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// These public keys are structural fixtures only. No test treats them as a
// successful cryptographic proof or bypasses the real historical verifier.
func structuralPolicyForTest(t *testing.T) *ynxauth.State {
	t.Helper()
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	s := cloneAccountPolicy(d.accountPolicy)
	s.Records = []ynxauth.Record{{AlgorithmVersion: ynxbatch.Version,
		Owner: "0x" + strings.Repeat("2", 40), PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize),
		Revision: 1, RegisteredAt: 2, ActiveFrom: 3, LedgerNonce: 1}}
	return s
}

func TestPQSnapshotPolicyContinuation(t *testing.T) {
	before := structuralPolicyForTest(t)
	if err := validateAccountPolicyContinuation(before, cloneAccountPolicy(before)); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(*ynxauth.State) *ynxauth.State
	}{
		{"omitted", func(*ynxauth.State) *ynxauth.State { return nil }},
		{"empty", func(*ynxauth.State) *ynxauth.State { return &ynxauth.State{} }},
		{"network", func(s *ynxauth.State) *ynxauth.State { s.NetworkID[0] ^= 1; return s }},
		{"activation", func(s *ynxauth.State) *ynxauth.State { s.EnableAt--; return s }},
		{"deleted history", func(s *ynxauth.State) *ynxauth.State { s.Records = nil; return s }},
		{"replaced key", func(s *ynxauth.State) *ynxauth.State { s.Records[0].PKA[0] ^= 1; return s }},
		{"replaced active height", func(s *ynxauth.State) *ynxauth.State { s.Records[0].ActiveFrom++; return s }},
		{"replaced nonce", func(s *ynxauth.State) *ynxauth.State { s.Records[0].LedgerNonce++; return s }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateAccountPolicyContinuation(before, tc.mutate(cloneAccountPolicy(before))); err == nil {
				t.Fatal("accepted policy rollback or rewrite")
			}
		})
	}
	after := cloneAccountPolicy(before)
	newOwner := after.Records[0]
	newOwner.Owner = "0x" + strings.Repeat("1", 40)
	nextRevision := after.Records[0]
	nextRevision.Revision, nextRevision.RegisteredAt, nextRevision.ActiveFrom, nextRevision.LedgerNonce = 2, 3, 4, 2
	after.Records = []ynxauth.Record{newOwner, after.Records[0], nextRevision}
	if err := validateAccountPolicyContinuation(before, after); err != nil {
		t.Fatalf("rejected sorted owner insertion and revision append: %v", err)
	}
}

func TestPQSnapshotVersionAndDomain(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	legacy := policySnapshotForTest(t, d)
	if legacy.Version != 2 || legacy.AccountPolicy != nil {
		t.Fatal("legacy snapshot unexpectedly upgraded")
	}
	unsigned := legacy
	unsigned.StateIntegrity = ""
	wire, err := json.Marshal(unsigned)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(append([]byte("YNX_CHAIN_DEVNET_SNAPSHOT_V2\x00"), wire...))
	if legacy.StateIntegrity != hex.EncodeToString(digest[:]) {
		t.Fatal("legacy v2 integrity bytes changed")
	}
	unsigned.Version = legacyDevnetSnapshotVersion
	if err := validateDevnetSnapshotIntegrity(unsigned); err != nil {
		t.Fatalf("legacy v1 no-integrity snapshot rejected: %v", err)
	}
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	pq := policySnapshotForTest(t, d)
	if pq.Version != pqDevnetSnapshotVersion || pq.AccountPolicy == nil {
		t.Fatal("enabled policy did not select v3")
	}
	unsigned = pq
	unsigned.StateIntegrity = ""
	wire, err = json.Marshal(unsigned)
	if err != nil {
		t.Fatal(err)
	}
	digest = sha256.Sum256(append([]byte("YNX_CHAIN_DEVNET_SNAPSHOT_V3\x00"), wire...))
	if pq.StateIntegrity != hex.EncodeToString(digest[:]) {
		t.Fatal("v3 domain is not bound to its complete snapshot")
	}
	for _, version := range []int{legacyDevnetSnapshotVersion, devnetSnapshotVersion} {
		bad := pq
		bad.Version = version
		bad.StateIntegrity, _ = devnetSnapshotIntegrity(bad)
		if err := validateDevnetSnapshotIntegrity(bad); err == nil {
			t.Fatal("old version accepted policy")
		}
	}
	missing := pq
	missing.AccountPolicy = nil
	missing.StateIntegrity, _ = devnetSnapshotIntegrity(missing)
	if err := validateDevnetSnapshotIntegrity(missing); err == nil {
		t.Fatal("v3 accepted missing policy")
	}
	for _, mutation := range []func(*devnetSnapshot){
		func(s *devnetSnapshot) { s.AccountPolicy = &ynxauth.State{} },
		func(s *devnetSnapshot) { s.AccountPolicy.NetworkID[0] ^= 1 },
		func(s *devnetSnapshot) { s.Pending = []Transaction{{Memo: pqTransferMemo + "invalid"}} },
	} {
		bad := pq
		bad.AccountPolicy = cloneAccountPolicy(pq.AccountPolicy)
		mutation(&bad)
		if err := validateAccountPolicySnapshot(bad); err == nil {
			t.Fatal("accepted uninitialized policy, wrong genesis, or invalid historical proof")
		}
	}
}

func TestPQSnapshotPolicyDeepCopies(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.accountPolicy = structuralPolicyForTest(t)
	s := d.snapshotLocked()
	s.AccountPolicy.NetworkID[0] ^= 1
	s.AccountPolicy.Records[0].PKA[0] ^= 1
	if bytes.Equal(s.AccountPolicy.NetworkID, d.accountPolicy.NetworkID) || bytes.Equal(s.AccountPolicy.Records[0].PKA, d.accountPolicy.Records[0].PKA) {
		t.Fatal("snapshot aliases live policy")
	}
	s = d.snapshotLocked()
	d.applySnapshotLocked(s)
	s.AccountPolicy.NetworkID[0] ^= 1
	s.AccountPolicy.Records[0].PKB[0] ^= 1
	if bytes.Equal(s.AccountPolicy.NetworkID, d.accountPolicy.NetworkID) || bytes.Equal(s.AccountPolicy.Records[0].PKB, d.accountPolicy.Records[0].PKB) {
		t.Fatal("applied policy aliases caller snapshot")
	}
}

func TestPQSnapshotRequiresOriginalRegistrationEvidence(t *testing.T) {
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	s := policySnapshotForTest(t, d)
	s.Version = pqDevnetSnapshotVersion
	s.AccountPolicy = structuralPolicyForTest(t)
	if err := validateAccountPolicySnapshot(s); err == nil || !strings.Contains(err.Error(), "missing its original migration proof") {
		t.Fatalf("unproved registration was not rejected: %v", err)
	}
	s.AccountPolicy.Records[0].RegisteredAt = 3
	s.AccountPolicy.Records[0].ActiveFrom = 4
	if err := validateAccountPolicySnapshot(s); err == nil || !strings.Contains(err.Error(), "ahead of snapshot") {
		t.Fatalf("future registration was not rejected: %v", err)
	}
	// Intermediate State has no tip or block history. Evidence checks occur
	// only after the receiver attaches the complete candidate history.
	s.Blocks = nil
	if err := validateAccountPolicySnapshot(s); err != nil {
		t.Fatalf("partial structural validation failed: %v", err)
	}
}

func TestPQSnapshotIntermediateReplicationRetainsPolicy(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	source := NewDevnet(cfg)
	source.ProduceBlock()
	source.ProduceBlock()
	destination := NewDevnet(cfg)
	if err := destination.EnableAccountPQ(3); err != nil {
		t.Fatal(err)
	}
	base := destination.LatestBlock()
	partial, err := source.replicationBatchJSONWithLimit(base.Height, base.Hash, 1, MaxReplicationBatchPayloadBytes)
	if err != nil {
		t.Fatal(err)
	}
	if result, err := destination.ApplyReplicationBatchJSON(partial); err != nil || !result.Applied || result.Complete {
		t.Fatalf("intermediate block-only suffix failed: %+v %v", result, err)
	}
	if destination.accountPolicy == nil || destination.accountPolicy.EnableAt != 3 {
		t.Fatal("intermediate suffix removed policy")
	}
	base = destination.LatestBlock()
	complete, err := source.ReplicationBatchJSON(base.Height, base.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := destination.ApplyReplicationBatchJSON(complete); err == nil {
		t.Fatal("complete higher-height suffix removed policy")
	}
	full, err := source.ReplicationSnapshotJSON()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := destination.ApplyReplicationSnapshotJSON(full, true); err == nil {
		t.Fatal("complete higher-height snapshot removed policy")
	}
	if destination.LatestHeight() != base.Height || destination.accountPolicy.EnableAt != 3 {
		t.Fatal("rejected final state changed history or policy")
	}
}

func TestPQSnapshotSameHeightReplicationAndRestart(t *testing.T) {
	for _, batchMode := range []bool{false, true} {
		name := "full"
		if batchMode {
			name = "batch"
		}
		t.Run(name, func(t *testing.T) {
			cfg := DefaultNetworkConfig("testnet")
			source := NewDevnet(cfg)
			legacyPayload, err := source.ReplicationSnapshotJSON()
			if err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			destination, err := NewPersistentDevnet(cfg, dir)
			if err != nil {
				t.Fatal(err)
			}
			if err := source.EnableAccountPQ(2); err != nil {
				t.Fatal(err)
			}
			apply := func() ReplicationApplyResult {
				t.Helper()
				var payload []byte
				var result ReplicationApplyResult
				if batchMode {
					base := destination.LatestBlock()
					payload, err = source.ReplicationBatchJSON(base.Height, base.Hash)
					if err == nil {
						result, err = destination.ApplyReplicationBatchJSON(payload)
					}
				} else {
					payload, err = source.ReplicationSnapshotJSON()
					if err == nil {
						result, err = destination.ApplyReplicationSnapshotJSON(payload, false)
					}
				}
				if err != nil {
					t.Fatal(err)
				}
				return result
			}
			if !apply().Applied || destination.accountPolicy == nil || destination.accountPolicy.EnableAt != 2 {
				t.Fatal("same-height policy enable was dropped")
			}
			if apply().Applied {
				t.Fatal("identical same-height state was reapplied")
			}
			// Admission can change balances/pending transactions without advancing
			// the tip. A policy-bearing final state must preserve those fields too.
			if _, err := source.Faucet("ynx_pq_snapshot_faucet", 20); err != nil {
				t.Fatal(err)
			}
			if !apply().Applied {
				t.Fatal("same-height application state was dropped")
			}
			if account, ok := destination.Account("ynx_pq_snapshot_faucet"); !ok || account.Balance != 20 {
				t.Fatal("same-height state lost account balance")
			}
			marker, err := os.ReadFile(destination.snapshotIntegrityMarkerPath())
			if err != nil || string(marker) != "3\n" {
				t.Fatalf("v3 durable marker missing: %q, %v", marker, err)
			}
			restarted, err := NewPersistentDevnet(cfg, dir)
			if err != nil || restarted.accountPolicy == nil || restarted.accountPolicy.EnableAt != 2 {
				t.Fatalf("restart lost policy: %v", err)
			}
			if _, err := destination.ApplyReplicationSnapshotJSON(legacyPayload, true); err == nil {
				t.Fatal("same-height authoritative rebase removed policy")
			}
			legacySource := NewDevnet(cfg)
			base := destination.LatestBlock()
			legacyBatch, err := legacySource.ReplicationBatchJSON(base.Height, base.Hash)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := destination.ApplyReplicationBatchJSON(legacyBatch); err == nil {
				t.Fatal("same-height no-state batch concealed missing policy")
			}
		})
	}
}

func TestPQSnapshotStaleCandidateCannotOverwritePolicy(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	old := policySnapshotForTest(t, d)
	base := d.LatestBlock()
	if err := d.EnableAccountPQ(2); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(d.snapshotPath())
	if err != nil {
		t.Fatal(err)
	}
	// Model a candidate validated before a same-height policy mutation, then
	// entering its final persistence phase after the mutation was committed.
	if err := d.commitReplicationSnapshot(old, base.Height, base.Hash); err == nil {
		t.Fatal("stale candidate overwrote the current policy")
	}
	after, err := os.ReadFile(d.snapshotPath())
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rejected candidate changed durable state: %v", err)
	}
}

func TestPQSnapshotConcurrentCommitsPreserveDurablePolicy(t *testing.T) {
	cfg := DefaultNetworkConfig("testnet")
	d, err := NewPersistentDevnet(cfg, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	base := d.LatestBlock()
	candidates := make([]devnetSnapshot, 2)
	for i := range candidates {
		source := NewDevnet(cfg)
		if err := source.EnableAccountPQ(uint64(i + 2)); err != nil {
			t.Fatal(err)
		}
		candidates[i] = policySnapshotForTest(t, source)
	}
	start := make(chan struct{})
	committed := make(chan error, 2)
	for _, candidate := range candidates {
		go func(snapshot devnetSnapshot) {
			<-start
			committed <- d.commitReplicationSnapshot(snapshot, base.Height, base.Hash)
		}(candidate)
	}
	checkpoint := make(chan error, 1)
	go func() {
		<-start
		checkpoint <- d.persistSnapshot()
	}()
	close(start)
	first, second := <-committed, <-committed
	if (first == nil) == (second == nil) {
		t.Fatalf("exactly one incompatible schedule must commit: %v; %v", first, second)
	}
	if err := <-checkpoint; err != nil {
		t.Fatal(err)
	}
	restarted, err := NewPersistentDevnet(cfg, d.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.accountPolicy == nil || d.accountPolicy == nil || restarted.accountPolicy.EnableAt != d.accountPolicy.EnableAt {
		t.Fatal("concurrent replication/checkpoint left disk and memory with different policies")
	}
}

func TestPQSnapshotUnknownCommitKeepsExposedPolicy(t *testing.T) {
	for _, appendRecord := range []bool{false, true} {
		name := "enable"
		if appendRecord {
			name = "append registration"
		}
		t.Run(name, func(t *testing.T) {
			d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if appendRecord {
				if err := d.EnableAccountPQ(2); err != nil {
					t.Fatal(err)
				}
				d.ProduceBlock()
				d.ProduceBlock()
			}
			candidate := policySnapshotForTest(t, d)
			candidate.AccountPolicy = structuralPolicyForTest(t)
			if !appendRecord {
				candidate.AccountPolicy.Records = nil
			}
			// This is a fault-injection unit of the already-validated commit
			// phase. Structural fixture keys never count as a verified migration.
			newTx := Transaction{Hash: "0x" + strings.Repeat("b", 64), Type: "faucet", From: "faucet", To: "ynx_unknown_checkpoint", Amount: 1}
			candidate.Pending = append(candidate.Pending, newTx)
			candidate, err = sealDevnetSnapshot(candidate)
			if err != nil {
				t.Fatal(err)
			}
			base := d.LatestBlock()
			oldDurableHeight := d.replicationDurableHeight
			if err := os.Mkdir(d.snapshotIntegrityMarkerPath()+".tmp", 0o700); err != nil {
				t.Fatal(err)
			}
			err = d.commitReplicationSnapshot(candidate, base.Height, base.Hash)
			if !errors.Is(err, ErrSnapshotDurabilityUncertain) {
				t.Fatalf("marker failure did not retain UNKNOWN: %v", err)
			}
			wire, err := os.ReadFile(d.snapshotPath())
			if err != nil {
				t.Fatal(err)
			}
			var exposed devnetSnapshot
			if err := json.Unmarshal(wire, &exposed); err != nil {
				t.Fatal(err)
			}
			if exposed.Version != pqDevnetSnapshotVersion || exposed.AccountPolicy == nil || d.accountPolicy == nil {
				t.Fatal("UNKNOWN reverted exposed policy in memory")
			}
			if err := validateAccountPolicyContinuation(exposed.AccountPolicy, d.accountPolicy); err != nil {
				t.Fatalf("disk policy is stronger than in-memory policy: %v", err)
			}
			if d.replicationDurableHeight != oldDurableHeight || d.lastPersistenceError == "" {
				t.Fatal("UNKNOWN was mislabeled as a completed checkpoint")
			}
			if _, uncertain := d.uncertainTransactions[newTx.Hash]; !uncertain {
				t.Fatal("new UNKNOWN transaction lost its admission guard")
			}
			_, durability, found := d.TransactionWithDurability(newTx.Hash)
			if !found || durability.Status != "uncertain" {
				t.Fatalf("UNKNOWN acquired a durable receipt: %+v, found=%t", durability, found)
			}
			if appendRecord {
				d.mu.Lock()
				legacyErr := d.requireLegacyAccountLocked(candidate.AccountPolicy.Records[0].Owner)
				d.mu.Unlock()
				if !errors.Is(legacyErr, ynxauth.ErrPolicy) {
					t.Fatalf("UNKNOWN reopened classic authorization: %v", legacyErr)
				}
			}
			if err := os.Remove(d.snapshotIntegrityMarkerPath() + ".tmp"); err != nil {
				t.Fatal(err)
			}
			if err := d.commitReplicationSnapshot(candidate, base.Height, base.Hash); err != nil {
				t.Fatalf("identical UNKNOWN candidate could not be confirmed: %v", err)
			}
			if d.lastPersistenceError != "" || len(d.uncertainTransactions) != 0 {
				t.Fatal("successful reconciliation kept UNKNOWN state")
			}
			_, durability, _ = d.TransactionWithDurability(newTx.Hash)
			if durability.Status != "pending_durable" {
				t.Fatalf("successful reconciliation did not establish pending durability: %+v", durability)
			}
		})
	}
}

func TestPQSnapshotPreRenameFailureKeepsOriginalPolicy(t *testing.T) {
	d, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	candidate := policySnapshotForTest(t, d)
	candidate.AccountPolicy = structuralPolicyForTest(t)
	candidate.AccountPolicy.Records = nil
	candidate, err = sealDevnetSnapshot(candidate)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(d.snapshotPath())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(d.snapshotPath()+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	base := d.LatestBlock()
	err = d.commitReplicationSnapshot(candidate, base.Height, base.Hash)
	if err == nil || errors.Is(err, ErrSnapshotDurabilityUncertain) || d.accountPolicy != nil {
		t.Fatalf("pre-rename rejection applied candidate: %v", err)
	}
	after, err := os.ReadFile(d.snapshotPath())
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("pre-rename rejection changed exposed snapshot: %v", err)
	}
}

func TestPQSnapshotIdenticalReplicationReconcilesUnknown(t *testing.T) {
	for _, batchMode := range []bool{false, true} {
		name := "full"
		if batchMode {
			name = "batch"
		}
		t.Run(name, func(t *testing.T) {
			cfg := DefaultNetworkConfig("testnet")
			source := NewDevnet(cfg)
			if err := source.EnableAccountPQ(2); err != nil {
				t.Fatal(err)
			}
			d, err := NewPersistentDevnet(cfg, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			var payload []byte
			if batchMode {
				base := d.LatestBlock()
				payload, err = source.ReplicationBatchJSON(base.Height, base.Hash)
			} else {
				payload, err = source.ReplicationSnapshotJSON()
			}
			if err != nil {
				t.Fatal(err)
			}
			apply := func() (ReplicationApplyResult, error) {
				if batchMode {
					return d.ApplyReplicationBatchJSON(payload)
				}
				return d.ApplyReplicationSnapshotJSON(payload, false)
			}
			if err := os.Mkdir(d.snapshotIntegrityMarkerPath()+".tmp", 0o700); err != nil {
				t.Fatal(err)
			}
			if _, err := apply(); !errors.Is(err, ErrSnapshotDurabilityUncertain) || d.accountPolicy == nil {
				t.Fatalf("failed replication did not retain exposed policy and UNKNOWN: %v", err)
			}
			if _, err := apply(); !errors.Is(err, ErrSnapshotDurabilityUncertain) {
				t.Fatalf("identical no-op falsely confirmed UNKNOWN: %v", err)
			}
			if err := os.Remove(d.snapshotIntegrityMarkerPath() + ".tmp"); err != nil {
				t.Fatal(err)
			}
			if result, err := apply(); err != nil || !result.Applied || d.lastPersistenceError != "" {
				t.Fatalf("identical replication did not retry checkpoint: %+v %v", result, err)
			}
			marker, err := os.ReadFile(d.snapshotIntegrityMarkerPath())
			if err != nil || string(marker) != "3\n" {
				t.Fatalf("reconciliation did not confirm v3 marker: %q %v", marker, err)
			}
		})
	}
}
