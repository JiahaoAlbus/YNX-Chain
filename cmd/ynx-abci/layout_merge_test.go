//go:build unix

package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func startupMigration(t *testing.T) (chain.ConsensusMigrationState, string) {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "migration.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return m, path
}

func TestMergedABCIStartupPreservesThreeRealLayoutsAndWriterLease(t *testing.T) {
	m, migrationPath := startupMigration(t)
	payload, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "original.state")
			app, lease, height, err := prepareApplication(migrationPath, path, layout, "", consensus.ConsensusBootstrapPins{}, "", "")
			if err != nil || app == nil || lease == nil || height != m.Height {
				t.Fatal("normal constructor rejected original layout", err)
			}
			defer lease.Close()
			other, second, _, err := prepareApplication(migrationPath, path, layout, "", consensus.ConsensusBootstrapPins{}, "", "")
			if err == nil || other != nil || second != nil {
				if second != nil {
					second.Close()
				}
				t.Fatal("two actual entrypoints acquired same writer state")
			}
			ctx := context.Background()
			if _, err = app.InitChain(ctx, &abci.RequestInitChain{ChainId: fmt.Sprintf("ynx_%d-1", m.Network.ChainID), InitialHeight: int64(m.Height) + 1, AppStateBytes: payload}); err != nil {
				t.Fatal(err)
			}
			finalized, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: int64(m.Height) + 1, Time: time.Unix(1802736000, 0).UTC()})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			switch layout {
			case "atomic-json":
				if !bytes.HasPrefix(bytes.TrimSpace(raw), []byte("{")) {
					t.Fatal("atomic layout silently changed")
				}
			case "snapshot-journal":
				if !bytes.HasPrefix(raw, []byte("YNX_ABCI_SNAPSHOT_JOURNAL_V1\n")) {
					t.Fatal("snapshot journal flag lost")
				}
			case "block-journal":
				if !bytes.HasPrefix(raw, []byte("YNX_ABCI_BLOCK_JOURNAL_V2\n")) {
					t.Fatal("block journal flag lost")
				}
			}
			if err = lease.Close(); err != nil {
				t.Fatal(err)
			}
			restored, reopened, _, err := prepareApplication(migrationPath, path, layout, "", consensus.ConsensusBootstrapPins{}, "", "")
			if err != nil {
				t.Fatal("actual layout restart failed", err)
			}
			info, err := restored.Info(ctx, &abci.RequestInfo{})
			if err != nil || info.LastBlockHeight != int64(m.Height)+1 || !bytes.Equal(info.LastBlockAppHash, finalized.AppHash) {
				t.Fatal("layout lost original checkpoint", err)
			}
			reopened.Close()
			for _, wrong := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
				if wrong == layout {
					continue
				}
				wrongApp, wrongLease, _, err := prepareApplication(migrationPath, path, wrong, "", consensus.ConsensusBootstrapPins{}, "", "")
				if err == nil || wrongApp != nil || wrongLease != nil {
					if wrongLease != nil {
						wrongLease.Close()
					}
					t.Fatal("incompatible original layout silently converted", wrong)
				}
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(after, raw) {
					t.Fatal("wrong-layout refusal changed original state", err)
				}
			}
		})
	}
}

func TestMergedABCIJournalPQConfigurationRefusesBeforeAnyStateOpen(t *testing.T) {
	for _, layout := range []string{"snapshot-journal", "block-journal"} {
		for _, name := range []string{"genesis", "genesis-pin", "native-pin", "migration-pin", "schedule", "schedule-pin"} {
			t.Run(layout+"/"+name, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "never-opened.state")
				var pins consensus.ConsensusBootstrapPins
				genesis, schedule, scheduleHash := "", "", ""
				switch name {
				case "genesis":
					genesis = "missing-genesis"
				case "genesis-pin":
					pins.CometGenesisSHA256 = strings.Repeat("01", 32)
				case "native-pin":
					pins.OriginalGenesisHash = strings.Repeat("02", 32)
				case "migration-pin":
					pins.MigrationStateHash = strings.Repeat("03", 32)
				case "schedule":
					schedule = "missing-schedule"
				case "schedule-pin":
					scheduleHash = strings.Repeat("04", 32)
				}
				app, lease, _, err := prepareApplication("missing-migration", path, layout, genesis, pins, schedule, scheduleHash)
				if err == nil || app != nil || lease != nil || !strings.Contains(err.Error(), "require") {
					t.Fatal("journal ignored or consumed incomplete independent PQ authority", err)
				}
				for _, candidate := range []string{path, path + ".writer.lock", path + ".lock", path + ".read.lock"} {
					if _, err = os.Lstat(candidate); !os.IsNotExist(err) {
						t.Fatal("unsupported startup touched state/locks", candidate, err)
					}
				}
			})
		}
	}
}

func TestMergedABCIConstructorFailureReleasesLeaseAndNeverDowngrades(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		path := filepath.Join(t.TempDir(), "failed.state")
		app, lease, _, err := prepareApplication("missing-migration", path, layout, "", consensus.ConsensusBootstrapPins{}, "", "")
		if err == nil || app != nil || lease != nil {
			t.Fatal("failed preparation retained an app or public lease")
		}
		reclaimed, err := consensus.AcquireApplicationStateWriterLease(path)
		if err != nil {
			t.Fatal("startup error leaked writer lease", err)
		}
		reclaimed.Close()
		if _, err = os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("failed load created state")
		}
	}
	path := filepath.Join(t.TempDir(), "unrecognized.state")
	if app, lease, _, err := prepareApplication("missing", path, "automatic-convert", "", consensus.ConsensusBootstrapPins{}, "", ""); err == nil || app != nil || lease != nil {
		t.Fatal("unknown layout downgraded")
	}
	if _, err := os.Stat(path + ".writer.lock"); !os.IsNotExist(err) {
		t.Fatal("unknown layout opened writer")
	}
}

func TestMergedABCIAtomicStartupStillConsumesIndependentBootstrapPins(t *testing.T) {
	m, _ := startupMigration(t)
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, v := range m.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 51)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		h := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(h[:20]))})
		clear(key)
	}
	bound, err := m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(bound, time.Unix(1792285200, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(sum[:]), OriginalGenesisHash: bound.OriginalGenesisHash, MigrationStateHash: bound.StateHash}
	dir := t.TempDir()
	migrationPath, genesisPath, statePath := filepath.Join(dir, "migration.json"), filepath.Join(dir, "genesis.json"), filepath.Join(dir, "original.state")
	payload, err := bound.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(migrationPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(genesisPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	app, lease, height, err := prepareApplication(migrationPath, statePath, "atomic-json", genesisPath, pins, "", "")
	if err != nil || app == nil || height != bound.Height {
		t.Fatal("valid independently pinned atomic startup rejected", err)
	}
	lease.Close()
	for _, field := range []string{"comet", "native", "migration"} {
		bad := pins
		switch field {
		case "comet":
			bad.CometGenesisSHA256 = strings.Repeat("a1", 32)
		case "native":
			bad.OriginalGenesisHash = strings.Repeat("a2", 32)
		case "migration":
			bad.MigrationStateHash = strings.Repeat("a3", 32)
		}
		app, lease, _, err = prepareApplication(migrationPath, statePath, "atomic-json", genesisPath, bad, "", "")
		if err == nil || app != nil || lease != nil {
			if lease != nil {
				lease.Close()
			}
			t.Fatal("independent pin was ignored", field)
		}
	}
	if _, err = os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatal("bootstrap preparation rewrote or synthesized persisted application state")
	}
}
