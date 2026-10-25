package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

type applicationInitializationFixture struct {
	migration chain.ConsensusMigrationState
	raw       []byte
	pins      ConsensusBootstrapPins
	bootstrap *ConsensusBootstrap
	contract  chain.ContractArtifact
	history   string
}

func newApplicationInitializationFixture(t *testing.T) applicationInitializationFixture {
	t.Helper()
	owner := mustNativeAddress(t, deterministicPrivateKey(111))
	recipient := mustNativeAddress(t, deterministicPrivateKey(112))
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	transfer, err := d.Transfer(owner, recipient, 7)
	if err != nil {
		t.Fatal(err)
	}
	source, _ := boundedContractFixture(t, "SampleEVMWriteCounter")
	contract, _, err := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", source, []string{"7"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = d.ExecuteContract(owner, contract.Address, "0x7cf5dab0"+strings.Repeat("0", 63)+"5"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 91)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		hash := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(hash[:20]))})
		clear(key)
	}
	migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCometGenesis(migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	pins := ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(hash[:]), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}
	bootstrap, err := NewConsensusBootstrap(raw, pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	contract, _ = d.Contract(contract.Address)
	if accountPosition(t, migration.Accounts, owner) < 0 || migration.Accounts[accountPosition(t, migration.Accounts, owner)].Nonce == 0 || migration.Runtime == nil || len(migration.Runtime.Blocks) < 2 || len(contract.RuntimeStorage) == 0 {
		t.Fatal("fixture must contain actual funded accounts, nonzero nonce, executed contract storage and original history")
	}
	return applicationInitializationFixture{migration: migration, raw: raw, pins: pins, bootstrap: bootstrap, contract: contract, history: transfer.Hash}
}

func TestInitializeApplicationAllLayoutsColdReadPreservesCompleteNativeSource(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	before, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "fresh-application", "state")
			options := ApplicationInitializationOptions{StatePath: path, StateLayout: layout}
			result, err := InitializeApplication(f.migration, f.raw, f.pins, options)
			if err != nil || result.Version != ApplicationInitializationVersion || !result.ColdReadVerified || result.Height != int64(f.migration.Height) || result.AppHash != f.migration.StateHash || result.Initialized || result.Deployed || result.PQActivated {
				t.Fatal("fresh original migration persistence did not pass", result, err)
			}
			cold, err := openInitializedApplication(f.migration, options, f.bootstrap)
			if err != nil {
				t.Fatal(err)
			}
			if !accountsEqual(cold.committed.Accounts, f.migration.Accounts) || cold.committed.ValidatorRegistry != nil || cold.committed.PQEngineSchedule != nil || cold.runtimeUpgradeCursor != nil || cold.pending != nil {
				t.Fatal("fresh import changed accounts/nonces or invented execution/consensus authority")
			}
			if cold.committed.LegacyContracts == nil || !bytes.Equal(mustJSON(t, cold.committed.LegacyContracts.Contracts[f.contract.Address]), mustJSON(t, f.contract)) || len(cold.committed.Contracts) != 1 {
				t.Fatal("actual contract provenance or executable storage was not preserved")
			}
			migrationQuery, err := cold.Query(context.Background(), &abci.RequestQuery{Path: "/migration"})
			if err != nil || migrationQuery.Code != 0 || !bytes.Equal(migrationQuery.Value, before) {
				t.Fatal("cold source migration changed", err)
			}
			history, err := cold.Query(context.Background(), &abci.RequestQuery{Path: "/migration/transactions/" + f.history})
			if err != nil || history.Code != 0 || !bytes.Contains(history.Value, []byte(f.history)) {
				t.Fatal("original native history is not queryable after cold read", err)
			}
			stateBytes, _ := json.Marshal(cold.committed)
			digest := sha256.Sum256(stateBytes)
			if result.StateSHA256 != hex.EncodeToString(digest[:]) {
				t.Fatal("result did not bind the complete cold state")
			}
			for _, name := range []string{filepath.Dir(path), path, path + ".writer.lock", filepath.Join(filepath.Dir(path), ".ynx-initialization-attempt.json")} {
				info, err := os.Lstat(name)
				want := os.FileMode(0o600)
				if name == filepath.Dir(path) {
					want = 0o700
				}
				if err != nil || info.Mode().Perm() != want || info.Mode()&os.ModeSymlink != 0 {
					t.Fatal("initialization material is not private", name, err)
				}
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = InitializeApplication(f.migration, f.raw, f.pins, options); err == nil {
				t.Fatal("repeated initialization overwrote an existing application")
			}
			after, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(original, after) {
				t.Fatal("refused repeat changed existing state", readErr)
			}
		})
	}
	after, err := f.migration.CanonicalJSON()
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("initialization mutated original migration", err)
	}
}

func TestInitializeApplicationRefusesExistingDestinationSidecarsAndSymlinks(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, kind := range []string{"empty-directory", "old-state", "sidecar", "unknown", "writer-lock", "directory-symlink", "parent-symlink"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			directory := filepath.Join(root, "candidate")
			path := filepath.Join(directory, "state")
			material := filepath.Join(root, "original-material")
			if err := os.WriteFile(material, []byte("original-data-and-UNKNOWN"), 0o600); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "empty-directory":
				if err := os.Mkdir(directory, 0o700); err != nil {
					t.Fatal(err)
				}
			case "old-state", "unknown", "writer-lock":
				if err := os.Mkdir(directory, 0o700); err != nil {
					t.Fatal(err)
				}
				name := path
				if kind == "unknown" {
					name += ".UNKNOWN"
				}
				if kind == "writer-lock" {
					name += ".writer.lock"
				}
				if err := os.WriteFile(name, []byte("existing-material"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "sidecar":
				if err := os.WriteFile(directory+".lock", []byte("existing-lock"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "directory-symlink":
				if err := os.Symlink(root, directory); err != nil {
					t.Fatal(err)
				}
			case "parent-symlink":
				alias := filepath.Join(root, "alias")
				if err := os.Symlink(root, alias); err != nil {
					t.Fatal(err)
				}
				path = filepath.Join(alias, "candidate", "state")
			}
			before := initializationTree(t, root)
			if _, err := InitializeApplication(f.migration, f.raw, f.pins, ApplicationInitializationOptions{StatePath: path, StateLayout: "atomic-json"}); err == nil {
				t.Fatal("unsafe existing destination accepted", kind)
			}
			if !reflect.DeepEqual(before, initializationTree(t, root)) {
				t.Fatal("refused initializer changed original material", kind)
			}
		})
	}
}

func initializationTree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := make(map[string]string)
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			out[path] = "symlink:" + target
		} else if entry.IsDir() {
			out[path] = "directory"
		} else {
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			out[path] = string(raw)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestInitializeApplicationWrongPinsAndHistoricalRuntimeDoNotReserveDestination(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, kind := range []string{"wrong-genesis", "wrong-migration", "wrong-native-genesis", "wrong-layout", "relative-path"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			options := ApplicationInitializationOptions{StatePath: filepath.Join(root, "candidate", "state"), StateLayout: "atomic-json"}
			pins := f.pins
			switch kind {
			case "wrong-genesis":
				pins.CometGenesisSHA256 = strings.Repeat("a", 64)
			case "wrong-migration":
				pins.MigrationStateHash = strings.Repeat("b", 64)
			case "wrong-native-genesis":
				pins.OriginalGenesisHash = strings.Repeat("c", 64)
			case "wrong-layout":
				options.StateLayout = "in-memory"
			case "relative-path":
				options.StatePath = "candidate/state"
			}
			if _, err := InitializeApplication(f.migration, f.raw, pins, options); err == nil {
				t.Fatal("invalid initializer accepted", kind)
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatal("invalid request reserved a destination", entries, err)
			}
		})
	}
	for _, version := range []int{12, 13} {
		old := newRuntimeUpgradeFixture(t, version)
		doc, err := BuildCometGenesis(old.migration, time.Unix(1802736000, 0).UTC())
		if err != nil {
			t.Fatal(err)
		}
		doc.ConsensusParams.Version.App = old.plan.OldApplicationVersion
		raw, err := cmtjson.Marshal(doc)
		if err != nil {
			t.Fatal(err)
		}
		pins := ConsensusBootstrapPins{CometGenesisSHA256: old.plan.CometGenesisSHA256, OriginalGenesisHash: old.migration.OriginalGenesisHash, MigrationStateHash: old.migration.StateHash}
		for _, supplied := range []bool{false, true} {
			root := t.TempDir()
			options := ApplicationInitializationOptions{StatePath: filepath.Join(root, "candidate", "state"), StateLayout: "atomic-json"}
			if supplied {
				options.RuntimeUpgrade = old.authorization
			}
			if _, err := InitializeApplication(old.migration, raw, pins, options); err == nil {
				t.Fatal("historical runtime initialized a fresh substitute checkpoint", version, supplied)
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatal("historical refusal wrote destination", err)
			}
		}
	}
}

func TestInitializeApplicationRetainsPartialAttemptAndRefusesRetry(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	path := filepath.Join(t.TempDir(), "candidate", "state")
	options := ApplicationInitializationOptions{StatePath: path, StateLayout: "atomic-json"}
	firstCause := errors.New("injected original destination write failure")
	_, err := initializeApplication(f.migration, f.raw, f.pins, options, &applicationInitializationHooks{afterReservation: func(directory string) error {
		if err := os.WriteFile(filepath.Join(directory, "partial.UNKNOWN"), []byte("retain-uncertain-write"), 0o600); err != nil {
			return err
		}
		return firstCause
	}})
	if !errors.Is(err, firstCause) {
		t.Fatal("initialization replaced its first cause", err)
	}
	before := initializationTree(t, filepath.Dir(path))
	if len(before) < 3 {
		t.Fatal("failed attempt removed its partial evidence", before)
	}
	if _, err := InitializeApplication(f.migration, f.raw, f.pins, options); err == nil {
		t.Fatal("partial attempt was silently replayed")
	}
	if !reflect.DeepEqual(before, initializationTree(t, filepath.Dir(path))) {
		t.Fatal("retry changed uncertain original files")
	}
}
