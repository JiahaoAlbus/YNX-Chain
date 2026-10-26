package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

func ownedMigrationSnapshotFixture(t *testing.T, pq bool) *Devnet {
	t.Helper()
	d := NewDevnet(DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet("ynx_owned_export_sender", 100); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Transfer("ynx_owned_export_sender", "ynx_owned_export_recipient", 7); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if pq {
		if err := d.EnableAccountPQ(2); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 32; i++ {
		d.ProduceBlock()
	}
	return d
}

func migrationOwnedSnapshot(t *testing.T, d *Devnet) devnetSnapshot {
	t.Helper()
	d.mu.RLock()
	snapshot, err := d.detachedSnapshotLocked()
	d.mu.RUnlock()
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func ownedMigrationJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestConsensusMigrationOwnedSnapshotMatchesLiveAndOriginalRuntimeEncoding(t *testing.T) {
	for _, version := range []int{legacyDevnetSnapshotVersion, devnetSnapshotVersion, pqDevnetSnapshotVersion} {
		t.Run(string(rune('0'+version)), func(t *testing.T) {
			d := ownedMigrationSnapshotFixture(t, version == pqDevnetSnapshotVersion)
			live, err := d.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			snapshot := migrationOwnedSnapshot(t, d)
			snapshot.Version = version
			if snapshot.AccountPolicy != nil {
				// A valid decoded file may explicitly encode an empty required
				// records array. snapshotLocked's original Clone normalizes it.
				snapshot.AccountPolicy.Records = []ynxauth.Record{}
			}
			if version == legacyDevnetSnapshotVersion {
				snapshot.StateIntegrity, snapshot.SponsorIntegrity = "", ""
			} else {
				snapshot.StateIntegrity, err = devnetSnapshotIntegrity(snapshot)
				if err != nil {
					t.Fatal(err)
				}
			}
			if err := validateReplicationSnapshot(snapshot, snapshot.Config); err != nil {
				t.Fatal("fixture must pass the real reader's full validation:", err)
			}
			// The complete history already belongs to the offline reader. Keep
			// its address and exact original bytes before transferring ownership.
			firstBlock := &snapshot.Blocks[0]
			history := ownedMigrationJSON(t, snapshot.Blocks)
			owned, err := exportOwnedConsensusMigrationSnapshot(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(ownedMigrationJSON(t, live), ownedMigrationJSON(t, owned)) {
				t.Fatal("owned export changed the original live canonical state or hash")
			}
			if &owned.Runtime.Blocks[0] != firstBlock {
				t.Fatal("owned export copied retained history instead of consuming it")
			}
			if !bytes.Equal(history, ownedMigrationJSON(t, owned.Runtime.Blocks)) || owned.OriginalGenesisHash != d.blocks[0].Hash || owned.Height != d.blocks[len(d.blocks)-1].Height || owned.LastBlockHash != d.blocks[len(d.blocks)-1].Hash {
				t.Fatal("owned export lost or rewrote retained genesis, history or tip")
			}
			// An independent small-fixture JSON round trip is the old runtime
			// representation, including optional empty maps and custom records.
			originalRuntime := normalizedConsensusRuntimeSnapshot(d.snapshotLocked())
			var roundTrip ConsensusRuntimeState
			if err := json.Unmarshal(ownedMigrationJSON(t, originalRuntime), &roundTrip); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(ownedMigrationJSON(t, roundTrip), ownedMigrationJSON(t, owned.Runtime)) {
				t.Fatal("owned runtime differs from the original full JSON representation")
			}
			withoutHash := owned
			withoutHash.StateHash = ""
			digest := sha256.Sum256(ownedMigrationJSON(t, withoutHash))
			if owned.StateHash != hex.EncodeToString(digest[:]) {
				t.Fatal("migration hash changed from SHA256 of original compact JSON")
			}
		})
	}
}

func TestConsensusMigrationOwnedLiveExportAndRestoreKeepNestedStateDetached(t *testing.T) {
	d := ownedMigrationSnapshotFixture(t, false)
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	beforeSource := ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(d.snapshotLocked()))
	beforeMigration := ownedMigrationJSON(t, migration)
	restored, err := migration.RestoreSourceRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(d.blocks, restored.blocks) || !reflect.DeepEqual(d.accounts, restored.accounts) || !reflect.DeepEqual(d.lots, restored.lots) {
		t.Fatal("restoration lost original history, balances, nonce or lots")
	}
	// These are real source receipts with nested EVM-compatible log topics.
	if len(restored.blocks[1].Transactions) == 0 || len(restored.blocks[1].Transactions[0].Logs) == 0 || len(restored.blocks[1].Transactions[0].Logs[0].Topics) == 0 || len(restored.resourcePolicy.Notes) == 0 {
		t.Fatal("fixture lacks the nested references this regression checks")
	}
	restored.accounts["ynx_owned_export_sender"].Balance++
	restored.accounts["ynx_owned_export_sender"].Lots["restore-only"] = 1
	restored.blocks[1].Transactions[0].Amount++
	restored.blocks[1].Transactions[0].Logs[0].Topics[0] = "restore-only"
	restored.resourcePolicy.Notes[0] = "restore-only"
	if !bytes.Equal(beforeMigration, ownedMigrationJSON(t, migration)) || !bytes.Equal(beforeSource, ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(d.snapshotLocked()))) {
		t.Fatal("restored state aliases its migration or original live source")
	}
	beforeRestored := ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(restored.snapshotLocked()))
	migration.Runtime.Accounts["ynx_owned_export_sender"].Nonce++
	migration.Runtime.Accounts["ynx_owned_export_sender"].Lots["export-only"] = 1
	migration.Runtime.Blocks[1].Transactions[0].Nonce++
	migration.Runtime.Blocks[1].Transactions[0].Logs[0].Topics[0] = "export-only"
	migration.Runtime.Policy.Notes[0] = "runtime-only"
	// Top-level execution copies must also remain separate from both runtime
	// and live source; otherwise mutating them can hide a boundary contradiction.
	for i := range migration.Accounts {
		if migration.Accounts[i].Address == "ynx_owned_export_sender" {
			migration.Accounts[i].Lots["execution-only"] = 1
		}
	}
	migration.ResourcePolicy.Notes[0] = "execution-only"
	if migration.Runtime.Policy.Notes[0] != "runtime-only" || migration.Runtime.Accounts["ynx_owned_export_sender"].Lots["execution-only"] != 0 {
		t.Fatal("top-level execution state aliases the retained runtime")
	}
	if !bytes.Equal(beforeSource, ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(d.snapshotLocked()))) || !bytes.Equal(beforeRestored, ownedMigrationJSON(t, normalizedConsensusRuntimeSnapshot(restored.snapshotLocked()))) {
		t.Fatal("public export aliases live or separately restored source")
	}
}

func TestConsensusMigrationOwnedSnapshotKeepsDurableDEXEmptyMapEncoding(t *testing.T) {
	d, _ := dexPersistenceFixture(t, NativeDexActionSwapExactInput)
	live, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	snapshot := migrationOwnedSnapshot(t, d)
	// Both nil and explicitly empty optional maps have the same existing wire.
	for id, pool := range snapshot.DexPools {
		if len(pool.NativeLots1) == 0 {
			pool.NativeLots1 = map[string]int64{}
			snapshot.DexPools[id] = pool
		}
	}
	snapshot.StateIntegrity, err = devnetSnapshotIntegrity(snapshot)
	if err != nil || validateReplicationSnapshot(snapshot, snapshot.Config) != nil {
		t.Fatal("DEX fixture must pass original checkpoint validation:", err)
	}
	owned, err := exportOwnedConsensusMigrationSnapshot(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ownedMigrationJSON(t, live), ownedMigrationJSON(t, owned)) || len(owned.DexPools) != 1 || !reflect.DeepEqual(owned.DexPools[0], owned.Runtime.DexPools[owned.DexPools[0].ID]) {
		t.Fatal("owned export changed complete DEX state, optional map normalization or hash")
	}
}

func TestConsensusMigrationOwnedStreamingIntegrityKeepsOriginalJSONDomains(t *testing.T) {
	for _, pq := range []bool{false, true} {
		d := ownedMigrationSnapshotFixture(t, pq)
		snapshot := migrationOwnedSnapshot(t, d)
		digest := func(domain string, value devnetSnapshot) string {
			h := sha256.New()
			_, _ = h.Write([]byte(domain))
			_, _ = h.Write([]byte{0})
			_, _ = h.Write(ownedMigrationJSON(t, value))
			return hex.EncodeToString(h.Sum(nil))
		}
		snapshot.StateIntegrity = ""
		domain := devnetSnapshotHashDomain
		if pq {
			domain = pqDevnetSnapshotHashDomain
		}
		got, err := devnetSnapshotIntegrity(snapshot)
		if err != nil || got != digest(domain, snapshot) {
			t.Fatal("complete snapshot hash changed domain or compact JSON bytes:", err)
		}
		withoutBlocks := snapshot
		withoutBlocks.Blocks = nil
		got, err = replicationStateIntegrity(snapshot)
		if err != nil || got != digest(replicationStateHashDomain, withoutBlocks) {
			t.Fatal("replication metadata hash changed its original omitted-block framing:", err)
		}
		application := normalizedConsensusRuntimeSnapshot(withoutBlocks)
		application.SavedAt = time.Time{}
		got, err = replicationApplicationStateIntegrity(snapshot)
		if err != nil || got != digest(replicationStateHashDomain+"/application", application) {
			t.Fatal("replication application hash changed original normalization or domain:", err)
		}
	}
}
