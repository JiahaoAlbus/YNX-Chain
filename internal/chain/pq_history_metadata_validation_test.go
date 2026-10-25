package chain

import (
	"reflect"
	"testing"
)

// The original Run7 counterexamples stay byte-for-byte unchanged in
// pq_history_metadata_test.go. These extend the repair's provenance boundaries
// and exercise genuine history through each complete import path.
func TestPQHistoryMetadataOriginalImportPaths(t *testing.T) {
	f := newPQHistoryMetadataFixture(t)
	payload, err := f.ledger.d.ReplicationSnapshotJSON()
	pqMust(t, err)
	check := func(t *testing.T, d *Devnet) {
		t.Helper()
		if !reflect.DeepEqual(d.accountPolicy, f.ledger.d.accountPolicy) {
			t.Fatal("import changed original terminal policy or registration history")
		}
		for _, hash := range f.hashes {
			original, exists := f.ledger.d.Transaction(hash)
			if !exists {
				t.Fatal("source transaction missing")
			}
			got, exists := d.Transaction(hash)
			if !exists || !reflect.DeepEqual(got, original) {
				t.Fatal("import changed genuine original transaction, lot flow or system logs")
			}
		}
	}
	t.Run("full-and-cold", func(t *testing.T) {
		d, err := NewPersistentDevnet(f.ledger.d.cfg, t.TempDir())
		pqMust(t, err)
		_, err = d.ApplyReplicationSnapshotJSON(payload, false)
		pqMust(t, err)
		check(t, d)
		before := moduleBusinessState(t, d)
		cold, err := NewPersistentDevnet(d.cfg, d.dataDir)
		pqMust(t, err)
		check(t, cold)
		assertModuleState(t, cold, before)
	})
	t.Run("complete-batch", func(t *testing.T) {
		d := NewDevnet(f.ledger.d.cfg)
		base := d.LatestBlock()
		batch, err := f.ledger.d.ReplicationBatchJSON(base.Height, base.Hash)
		pqMust(t, err)
		_, err = d.ApplyReplicationBatchJSON(batch)
		pqMust(t, err)
		check(t, d)
	})
	t.Run("consensus-source-runtime", func(t *testing.T) {
		migration, err := f.ledger.d.ExportConsensusMigrationState()
		pqMust(t, err)
		pqMust(t, migration.Validate())
		d, err := migration.RestoreSourceRuntime()
		pqMust(t, err)
		check(t, d)
	})
}

func TestPQHistoryMetadataSourceLineageAndPendingBounds(t *testing.T) {
	f := newPQLedger(t)
	f.activate(t)
	transfer, _, err := f.d.SubmitPQTransfer(f.member(t, 2, 2))
	pqMust(t, err)
	_, _, err = f.d.SubmitAccountRevocation(pqRevocationWire(t, f, 3, 2, 1))
	pqMust(t, err)
	pqMust(t, validateAccountPolicySnapshot(pqBatchSnapshotCopy(t, f.d)))
	mutations := []struct {
		name string
		edit func(*devnetSnapshot, *Transaction)
	}{
		{"sponsor", func(_ *devnetSnapshot, tx *Transaction) { tx.Sponsor = f.owner }},
		{"pool", func(_ *devnetSnapshot, tx *Transaction) { tx.SponsorPoolID = "rsp_unsigned" }},
		{"resource-source", func(_ *devnetSnapshot, tx *Transaction) { tx.ResourceSource = "merchant-resource-pool" }},
		{"resource-type", func(_ *devnetSnapshot, tx *Transaction) { tx.ResourceType = "bandwidth" }},
		{"resource-consumed", func(_ *devnetSnapshot, tx *Transaction) { tx.ResourceConsumed = 1 }},
		{"action-reference", func(_ *devnetSnapshot, tx *Transaction) { tx.ActionReference = "unsigned:reference" }},
		{"pending-log", func(_ *devnetSnapshot, tx *Transaction) { tx.Logs = []EVMLog{{Data: "0x"}} }},
		{"pending-block-hash", func(_ *devnetSnapshot, tx *Transaction) { tx.BlockHash = f.d.blocks[1].Hash }},
		{"pending-block-number", func(_ *devnetSnapshot, tx *Transaction) { tx.BlockNum = 1 }},
		{"missing-flow", func(_ *devnetSnapshot, tx *Transaction) { tx.LotFlows = nil }},
		{"wrong-owner", func(_ *devnetSnapshot, tx *Transaction) { tx.LotFlows[0].From = f.to }},
		{"wrong-signed-recipient", func(_ *devnetSnapshot, tx *Transaction) { tx.LotFlows[0].To = f.owner }},
		{"wrong-total", func(_ *devnetSnapshot, tx *Transaction) { tx.LotFlows[0].Amount++ }},
		{"duplicate-lot", func(_ *devnetSnapshot, tx *Transaction) {
			tx.LotFlows[0].Amount = 1
			tx.LotFlows = append(tx.LotFlows, tx.LotFlows[0])
		}},
		{"missing-catalog", func(s *devnetSnapshot, tx *Transaction) { delete(s.Lots, tx.LotFlows[0].LotID) }},
		{"rewritten-catalog-identity", func(s *devnetSnapshot, tx *Transaction) {
			id := tx.LotFlows[0].LotID
			lot := s.Lots[id]
			lot.LotID = "different-lineage"
			s.Lots[id] = lot
		}},
		{"rewritten-issued-amount", func(s *devnetSnapshot, tx *Transaction) {
			id := tx.LotFlows[0].LotID
			lot := s.Lots[id]
			lot.Amount++
			s.Lots[id] = lot
		}},
		{"missing-original-issuance", func(s *devnetSnapshot, _ *Transaction) {
			// Keep the catalog and every genuine PQ signature. Removing just the
			// earlier faucet flow must not leave catalog membership as authority.
			for i := range s.Blocks[1].Transactions {
				if s.Blocks[1].Transactions[i].Type == "faucet" {
					s.Blocks[1].Transactions[i].LotFlows = nil
				}
			}
		}},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			bad := pqBatchSnapshotCopy(t, f.d)
			var tx *Transaction
			for i := range bad.Pending {
				if bad.Pending[i].Hash == transfer.Hash {
					tx = &bad.Pending[i]
				}
			}
			if tx == nil || len(tx.LotFlows) == 0 {
				t.Fatal("genuine pending source transfer missing")
			}
			mutation.edit(&bad, tx)
			if err := validateAccountPolicySnapshot(bad); err == nil {
				t.Fatal("source metadata or lineage mutation survived complete historical validation")
			}
		})
	}
}

func TestPQHistoryMetadataSharedProofHookDoesNotInventDevnetABCIInclusion(t *testing.T) {
	f := newPQHistoryMetadataFixture(t)
	for _, kind := range []string{"Member", "migration", "revocation"} {
		t.Run(kind, func(t *testing.T) {
			tx, found := f.ledger.d.Transaction(f.hashes[kind])
			if !found {
				t.Fatal("original signed receipt missing")
			}
			// Model only the shared proof hook's input shape: actual ABCI history
			// has native height/time, no Devnet block hash or source system log.
			// Its own state validator owns fee/inclusion execution evidence.
			tx.BlockHash, tx.Logs = "", nil
			if kind != "revocation" {
				tx.LotFlows = nil
			}
			pqMust(t, ValidateConsensusHistoricalPQTransaction(tx, f.ledger.d.accountPolicy, tx.BlockNum, f.ledger.d.cfg.ChainID))
			pqHistoryMetadataForgeSponsor(&tx)
			if err := ValidateConsensusHistoricalPQTransaction(tx, f.ledger.d.accountPolicy, tx.BlockNum, f.ledger.d.cfg.ChainID); err == nil {
				t.Fatal("shared proof hook accepted unsigned resource authority")
			}
		})
	}
}
