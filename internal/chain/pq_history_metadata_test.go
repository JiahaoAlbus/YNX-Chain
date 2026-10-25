package chain

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// These regressions deliberately require rejection of unsigned historical
// execution metadata. Every source receipt is first created by real dual-PQ
// admission and mined normally; only public snapshot metadata is then changed.
// The original wire, signatures, owner, amount, fee, nonce and tombstone remain.
// Until the corresponding history validators are repaired the rejection tests
// are expected to fail; no local Go execution is claimed by this source file.
type pqHistoryMetadataFixture struct {
	ledger *pqLedgerFixture
	hashes map[string]string
}

func newPQHistoryMetadataFixture(t *testing.T) pqHistoryMetadataFixture {
	t.Helper()
	f := newPQLedger(t)
	migration := f.activate(t)
	migrationTx, _, err := f.d.SubmitAccountMigration(migration)
	pqMust(t, err)
	memberTx, _, err := f.d.SubmitPQTransfer(f.member(t, 2, 2))
	pqMust(t, err)
	whole, err := f.d.SubmitPQBatch(f.whole(t, f.batchTransfer(3, 1), f.batchTransfer(4, 1)))
	pqMust(t, err)
	if len(whole.Results) != 2 || whole.Results[0].Outcome != "admitted" || whole.Results[1].Outcome != "admitted" {
		t.Fatal("genuine Whole fixture was not admitted")
	}
	revocationTx, _, err := f.d.SubmitAccountRevocation(pqRevocationWire(t, f, 5, 2, 1))
	pqMust(t, err)
	f.d.ProduceBlock()
	if _, effective := f.d.accountPolicy.RevocationAt(f.owner, 3); !effective {
		t.Fatal("fixture must have a committed effective terminal tombstone")
	}
	return pqHistoryMetadataFixture{ledger: f, hashes: map[string]string{
		"migration": migrationTx.Hash, "Member": memberTx.Hash,
		"Whole": whole.Results[0].TransactionHash, "revocation": revocationTx.Hash,
	}}
}

func pqHistoryMetadataTransaction(t *testing.T, blocks []Block, hash string) *Transaction {
	t.Helper()
	for i := range blocks {
		for j := range blocks[i].Transactions {
			if blocks[i].Transactions[j].Hash == hash {
				return &blocks[i].Transactions[j]
			}
		}
	}
	t.Fatal("genuine mined fixture transaction missing")
	return nil
}

func pqHistoryMetadataForgeSponsor(tx *Transaction) {
	tx.Sponsor = tx.From
	tx.SponsorPoolID = "rsp_forged_historical_pool"
	tx.ResourceSource = "merchant-resource-pool"
	tx.ResourceType = "bandwidth"
	tx.ResourceConsumed = 999
	tx.ActionReference = "forged:revoked-resource-grant"
}

func pqHistoryMetadataPayload(t *testing.T, snapshot devnetSnapshot) []byte {
	t.Helper()
	sealed, err := sealDevnetSnapshot(snapshot)
	pqMust(t, err)
	payload, err := json.Marshal(sealed)
	pqMust(t, err)
	return payload
}

func TestPQHistoryMetadataRejectsForgedExecutionFields(t *testing.T) {
	f := newPQHistoryMetadataFixture(t)
	// Positive control: terminal current policy must not invalidate genuinely
	// signed migration, Member and Whole history from their original heights.
	original := pqBatchSnapshotCopy(t, f.ledger.d)
	pqMust(t, validateReplicationSnapshot(original, f.ledger.d.cfg))
	mutations := []struct {
		name string
		edit func(*Transaction)
	}{
		{"unsigned-resource-grant", pqHistoryMetadataForgeSponsor},
		{"negative-lot-flow", func(tx *Transaction) { tx.LotFlows[0].Amount = -1 }},
		{"forged-system-log", func(tx *Transaction) { tx.Logs[0].Data = "0xdeadbeef" }},
		{"forged-log-position", func(tx *Transaction) { tx.Logs[0].TransactionIndex++; tx.Logs[0].LogIndex++ }},
	}
	for kind, hash := range f.hashes {
		for _, mutation := range mutations {
			t.Run(kind+"/"+mutation.name, func(t *testing.T) {
				bad := pqBatchSnapshotCopy(t, f.ledger.d)
				tx := pqHistoryMetadataTransaction(t, bad.Blocks, hash)
				if len(tx.LotFlows) == 0 || len(tx.Logs) != 1 {
					t.Fatal("source fee/transfer provenance or mined system log missing")
				}
				mutation.edit(tx)
				// The outer integrity seal is an unkeyed checksum. Recompute it
				// exactly as an importing producer/document author can do.
				payload := pqHistoryMetadataPayload(t, bad)
				destination := NewDevnet(f.ledger.d.cfg)
				before := moduleBusinessState(t, destination)
				if result, err := destination.ApplyReplicationSnapshotJSON(payload, false); err == nil {
					got, found := destination.Transaction(hash)
					t.Fatalf("accepted forged %s metadata under original PQ hash: applied=%v found=%v metadataSurvived=%v", mutation.name, result.Applied, found, reflect.DeepEqual(got, *tx))
				}
				assertModuleState(t, destination, before)
			})
		}
	}
}

func TestPQHistoryMetadataRejectsForgedRevocationAcrossImportBoundaries(t *testing.T) {
	f := newPQHistoryMetadataFixture(t)
	hash := f.hashes["revocation"]
	t.Run("cold-snapshot", func(t *testing.T) {
		bad := pqBatchSnapshotCopy(t, f.ledger.d)
		pqHistoryMetadataForgeSponsor(pqHistoryMetadataTransaction(t, bad.Blocks, hash))
		destination := NewDevnet(f.ledger.d.cfg)
		destination.dataDir = t.TempDir()
		before := moduleBusinessState(t, destination)
		pqMust(t, os.WriteFile(destination.snapshotPath(), pqHistoryMetadataPayload(t, bad), 0o600))
		if err := destination.loadSnapshot(); err == nil {
			t.Fatal("cold loader accepted forged resource grant on the original revocation receipt")
		}
		assertModuleState(t, destination, before)
	})
	t.Run("complete-replication-batch", func(t *testing.T) {
		destination := NewDevnet(f.ledger.d.cfg)
		base := destination.LatestBlock()
		payload, err := f.ledger.d.ReplicationBatchJSON(base.Height, base.Hash)
		pqMust(t, err)
		var batch replicationBatch
		pqMust(t, json.Unmarshal(payload, &batch))
		if !batch.Complete || batch.State == nil {
			t.Fatal("fixture must exercise final authoritative batch validation")
		}
		pqHistoryMetadataForgeSponsor(pqHistoryMetadataTransaction(t, batch.Blocks, hash))
		batch.Integrity, err = replicationBatchIntegrity(batch)
		pqMust(t, err)
		payload, err = json.Marshal(batch)
		pqMust(t, err)
		before := moduleBusinessState(t, destination)
		if _, err := destination.ApplyReplicationBatchJSON(payload); err == nil {
			t.Fatal("final replication candidate accepted forged original revocation metadata")
		}
		assertModuleState(t, destination, before)
	})
	t.Run("consensus-source-runtime", func(t *testing.T) {
		migration, err := f.ledger.d.ExportConsensusMigrationState()
		pqMust(t, err)
		// The unmodified full v2 source is valid, including all pre-revocation
		// signatures and their exact owner history. No fake validator keys exist.
		pqMust(t, migration.Validate())
		pqHistoryMetadataForgeSponsor(pqHistoryMetadataTransaction(t, migration.Runtime.Blocks, hash))
		migration.StateHash, err = migration.calculateHash()
		pqMust(t, err)
		if err := migration.Validate(); err == nil {
			t.Error("rehashed complete consensus source accepted forged revocation execution metadata")
		}
		if _, err := migration.RestoreSourceRuntime(); err == nil {
			t.Error("source runtime restoration imported forged original revocation metadata")
		}
	})
}

func TestPQHistoryMetadataSponsorClaimsCannotRestoreRevokedAuthority(t *testing.T) {
	f := newPQHistoryMetadataFixture(t)
	bad := pqBatchSnapshotCopy(t, f.ledger.d)
	pqHistoryMetadataForgeSponsor(pqHistoryMetadataTransaction(t, bad.Blocks, f.hashes["revocation"]))
	destination := NewDevnet(f.ledger.d.cfg)
	if _, err := destination.ApplyReplicationSnapshotJSON(pqHistoryMetadataPayload(t, bad), false); err != nil {
		// Closing the import boundary is the desired repair. This extra control
		// distinguishes the existing receipt-integrity bug from an authority bypass.
		return
	}
	before := moduleBusinessState(t, destination)
	if len(destination.ResourcePools(f.ledger.owner, "", "")) != 0 {
		t.Fatal("a transaction's forged Sponsor fields created resource pool authority")
	}
	create := resourcePoolCreateFixture(f.ledger.to, "merchant", "metadata-authority-check", time.Now().UTC().Add(time.Hour), "metadata-no-recovery")
	create.Authorization = mustResourceAuthorization(t, f.ledger.classic, destination.cfg.ChainID, ResourcePoolCreateAction, create, 6)
	if _, _, err := destination.CreateResourcePool(create); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatalf("forged Sponsor receipt restored revoked classic resource authority: %v", err)
	}
	if _, _, err := destination.SubmitPQTransfer(f.ledger.member(t, 6, 1)); !errors.Is(err, ynxauth.ErrPolicy) {
		t.Fatalf("forged Sponsor receipt restored revoked dual-PQ authority: %v", err)
	}
	assertModuleState(t, destination, before)
}
