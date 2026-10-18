package main

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
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/spf13/cobra"
)

type initializeCommandFixture struct {
	migration chain.ConsensusMigrationState
	bootstrap *consensus.ConsensusBootstrap
	options   initializeApplicationFlags
	originals map[string][]byte
}

func newInitializeCommandFixture(t *testing.T) initializeCommandFixture {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet("ynx_initializer_funded_owner", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Transfer("ynx_initializer_funded_owner", "ynx_initializer_recipient", 7); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 101)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		hash := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(hash[:20]))})
		clear(key)
	}
	migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(digest[:]), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}
	bootstrap, err := consensus.NewConsensusBootstrap(raw, pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	options := initializeApplicationFlags{genesis: filepath.Join(root, "genesis.json"), migration: filepath.Join(root, "migration.json"), genesisHash: pins.CometGenesisSHA256, originalGenesisHash: pins.OriginalGenesisHash, migrationHash: pins.MigrationStateHash}
	migrationBytes, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	originals := map[string][]byte{options.genesis: raw, options.migration: migrationBytes}
	for path, wire := range originals {
		if err := os.WriteFile(path, wire, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return initializeCommandFixture{migration: migration, bootstrap: bootstrap, options: options, originals: originals}
}

func (f initializeCommandFixture) args(path, layout string) []string {
	return []string{"initialize-application", "--consensus-genesis", f.options.genesis, "--migration-state", f.options.migration, "--abci-state", path, "--abci-state-layout", layout, "--consensus-genesis-sha256", f.options.genesisHash, "--original-genesis-hash", f.options.originalGenesisHash, "--bound-migration-state-hash", f.options.migrationHash}
}

func executeInitializeCommand(t *testing.T, args []string) ([]byte, error) {
	t.Helper()
	var output bytes.Buffer
	root := &cobra.Command{Use: "ynx-comet", SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error {
		return errors.New("initializer unexpectedly entered runtime configuration and home creation")
	}}
	root.AddCommand(newInitializeApplicationCommand())
	root.SetOut(&output)
	root.SetErr(&output)
	root.SetArgs(args)
	err := root.Execute()
	return output.Bytes(), err
}

func assertInitializeInputsUnchanged(t *testing.T, f initializeCommandFixture) {
	t.Helper()
	for path, original := range f.originals {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(original, got) {
			t.Fatal("initializer changed original input", path, err)
		}
	}
}

func TestInitializeApplicationCommandNormalEntryAllLayoutsAndColdOperatorRead(t *testing.T) {
	f := newInitializeCommandFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "new-application", "state")
			output, err := executeInitializeCommand(t, f.args(path, layout))
			if err != nil {
				t.Fatal("normal offline initializer failed", string(output), err)
			}
			var result consensus.ApplicationInitializationResult
			if err := json.Unmarshal(output, &result); err != nil || result.StatePath != path || result.StateLayout != layout || !result.ColdReadVerified || result.Height != int64(f.migration.Height) || result.AppHash != f.migration.StateHash || result.Initialized || result.Deployed || result.PQActivated {
				t.Fatal("normal initializer did not report the actual offline migration result", string(output), err)
			}
			cold, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, pqOptions{stateLayout: layout, recoveryFD: -1})
			if err != nil {
				t.Fatal("normal operator factory cannot reopen initialized state", err)
			}
			state, err := cold.Query(context.Background(), &abci.RequestQuery{Path: "/state"})
			if err != nil || state == nil {
				t.Fatal("cold state query failed", err)
			}
			if state.Code != 0 || state.Height != int64(f.migration.Height) || !bytes.Contains(state.Value, []byte(`"nonce":1`)) {
				t.Fatal("cold normal operator lost actual nonzero source nonce", string(state.Value), err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if output, err := executeInitializeCommand(t, f.args(path, layout)); err == nil {
				t.Fatal("normal command repeated initialization", string(output))
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("repeat changed original state", err)
			}
			assertInitializeInputsUnchanged(t, f)
		})
	}
}

func TestInitializeApplicationCommandRejectsIncompleteDuplicateAndPQFlagsBeforeWrites(t *testing.T) {
	f := newInitializeCommandFixture(t)
	for _, kind := range []string{"missing-layout", "duplicate-path", "duplicate-pin", "pq-schedule", "positional", "wrong-pin", "partial-runtime-plan"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "new-application", "state")
			args := f.args(path, "atomic-json")
			switch kind {
			case "missing-layout":
				args = append(args[:7], args[9:]...)
			case "duplicate-path":
				args = append(args, "--abci-state", filepath.Join(root, "other", "state"))
			case "duplicate-pin":
				args = append(args, "--consensus-genesis-sha256", f.options.genesisHash)
			case "pq-schedule":
				args = append(args, "--pq-engine-schedule", "untrusted-schedule.json")
			case "positional":
				args = append(args, "unexpected")
			case "wrong-pin":
				args[len(args)-1] = strings.Repeat("b", 64)
			case "partial-runtime-plan":
				args = append(args, "--runtime-upgrade-plan", filepath.Join(root, "plan.json"))
			}
			if output, err := executeInitializeCommand(t, args); err == nil {
				t.Fatal("invalid initializer flags accepted", kind, string(output))
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatal("refused command wrote destination", entries, err)
			}
			assertInitializeInputsUnchanged(t, f)
		})
	}
}

func TestInitializeApplicationCommandRejectsSymlinkAndDuplicateMigrationInputs(t *testing.T) {
	f := newInitializeCommandFixture(t)
	for _, kind := range []string{"symlink-genesis", "duplicate-migration-field"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "new-application", "state")
			args := f.args(path, "atomic-json")
			if kind == "symlink-genesis" {
				link := filepath.Join(root, "genesis-link.json")
				if err := os.Symlink(f.options.genesis, link); err != nil {
					t.Fatal(err)
				}
				args[2] = link
			} else {
				wire := bytes.TrimSpace(f.originals[f.options.migration])
				wire = append([]byte(`{"version":2,`), wire[1:]...)
				bad := filepath.Join(root, "ambiguous-migration.json")
				if err := os.WriteFile(bad, wire, 0o600); err != nil {
					t.Fatal(err)
				}
				args[4] = bad
			}
			if output, err := executeInitializeCommand(t, args); err == nil {
				t.Fatal("ambiguous original input accepted", kind, string(output))
			}
			if _, err := os.Lstat(filepath.Dir(path)); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("invalid original input reserved state", err)
			}
			assertInitializeInputsUnchanged(t, f)
		})
	}
}
