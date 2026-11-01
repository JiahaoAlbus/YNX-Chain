//go:build unix

package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
)

// These are the actual normal command/constructor callers. Every malformed
// input must fail before a Node, signer, state output or checkpoint is opened.
func TestNormalMigrationReadersRejectAmbiguousSourceAtActualEntries(t *testing.T) {
	f := newInitializeCommandFixture(t)
	wire := f.originals[f.options.migration]
	root := t.TempDir()
	config := cfg.DefaultConfig().SetRoot(root)
	if err := os.MkdirAll(filepath.Dir(config.NodeKeyFile()), 0o700); err != nil {
		t.Fatal(err)
	}
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x62}, ed25519.SeedSize))
	nodeKey := &p2p.NodeKey{PrivKey: cmted.PrivKey(key)}
	if err := nodeKey.SaveAs(config.NodeKeyFile()); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{config.PrivValidatorKeyFile(), config.PrivValidatorStateFile()} {
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("PRIVATE PUBLIC-TEST FIXTURE ONLY"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	originals := make(map[string][]byte)
	for _, p := range []string{config.NodeKeyFile(), config.PrivValidatorKeyFile(), config.PrivValidatorStateFile()} {
		var err error
		originals[p], err = os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
	}
	options := pqOptions{migration: f.options.migration, state: filepath.Join(root, "absent-application"),
		genesisHash: f.options.genesisHash, originalGenesisHash: f.options.originalGenesisHash,
		migrationHash: f.options.migrationHash, schedule: filepath.Join(root, "absent-schedule"),
		scheduleHash: "public-test-schedule-pin", binding: filepath.Join(root, "absent-binding"),
		vault: filepath.Join(root, "absent-vault"), recoveryFD: 3}
	wirePath := filepath.Join(root, "public-wire")
	if err := os.WriteFile(wirePath, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	proofArgs := []string{"--consensus-genesis", f.options.genesis, "--migration-state", f.options.migration,
		"--abci-state", options.state, "--abci-state-layout", "block-journal", "--comet-data-dir", filepath.Join(root, "absent-comet"),
		"--signing-state", config.PrivValidatorStateFile(), "--signing-lock-kind", "pq-signer",
		"--consensus-genesis-sha256", f.options.genesisHash, "--original-genesis-hash", f.options.originalGenesisHash,
		"--bound-migration-state-hash", f.options.migrationHash, "--pq-engine-schedule", options.schedule,
		"--pq-engine-schedule-hash", options.scheduleHash, "--account", "ynx_initializer_funded_owner",
		"--transaction-type", consensus.PQTransferType, "--envelope", wirePath, "--native-wire", wirePath,
		"--transaction-hash", strings.Repeat("1", 64), "--native-wire-hash", strings.Repeat("2", 64),
		"--lookup-height", "2", "--lookup-index", "0", "--engine-height", "3", "--engine-app-hash", strings.Repeat("3", 64),
		"--trusted-height", "1", "--trusted-block-hash", strings.Repeat("4", 64),
		"--trusting-period-nanoseconds", "3600000000000", "--max-clock-drift-nanoseconds", "0",
		"--trust-level-numerator", "1", "--trust-level-denominator", "3"}
	for _, tc := range []struct {
		name string
		wire []byte
	}{
		{"duplicate-root", append([]byte(`{"version":2,`), wire[1:]...)},
		{"folded-root", bytes.Replace(wire, []byte(`"version"`), []byte(`"Version"`), 1)},
		{"unknown-root", append([]byte(`{"foreign":0,`), wire[1:]...)},
		{"trailing-document", append(append([]byte(nil), wire...), '{', '}')},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Preserve the old permissive constructor counterexample explicitly.
			if tc.name == "duplicate-root" || tc.name == "folded-root" {
				var old chain.ConsensusMigrationState
				if err := json.Unmarshal(tc.wire, &old); err != nil || old.Validate() != nil {
					t.Fatal("counterexample no longer demonstrates the old whole-buffer reader", err)
				}
			}
			if err := os.WriteFile(f.options.migration, tc.wire, 0o600); err != nil {
				t.Fatal(err)
			}
			calls := []struct {
				name string
				call func() error
			}{
				{"local-node", func() error { _, _, err := constructPQNode(config, log.NewNopLogger(), options); return err }},
				{"bootstrap-only", func() error {
					o := options
					o.schedule, o.scheduleHash, o.binding, o.vault, o.recoveryFD = "", "", "", "", -1
					_, _, err := constructBootstrapNode(config, log.NewNopLogger(), o)
					return err
				}},
				{"runtime-upgrade", func() error {
					o := options
					o.schedule, o.scheduleHash, o.binding, o.vault, o.recoveryFD = "", "", "", "", -1
					o.runtimePlan, o.runtimePlanHash = filepath.Join(root, "absent-plan"), "public-test-plan-pin"
					_, _, err := constructRuntimeNode(config, log.NewNopLogger(), o)
					return err
				}},
				{"operator-checkpoint", func() error {
					c := newInspectOperatorCheckpointCommand()
					args := f.args(options.state, "block-journal")[1:]
					args = append(args, "--comet-data-dir", filepath.Join(root, "absent-comet"), "--signing-state", config.PrivValidatorStateFile())
					c.SetArgs(args)
					c.SetOut(io.Discard)
					c.SetErr(io.Discard)
					return c.Execute()
				}},
				{"proof-target", func() error { _, err := executeProofTargetInspection(proofArgs); return err }},
			}
			for _, call := range calls {
				t.Run(call.name, func(t *testing.T) {
					err := call.call()
					if err == nil || !(strings.Contains(err.Error(), "canonical") || strings.Contains(err.Error(), "decode complete migration JSON")) {
						t.Fatal("actual entry did not reject migration before later private/runtime inputs", err)
					}
				})
			}
		})
	}
	for p, raw := range originals {
		got, err := os.ReadFile(p)
		if err != nil || !bytes.Equal(got, raw) {
			t.Fatal("normal reader changed original test identity/signing history", err)
		}
	}
	if _, err := os.Stat(options.state); !os.IsNotExist(err) {
		t.Fatal("rejected migration opened application output", err)
	}
}

func TestNormalMigrationReadersLargeCanonicalBufferRegression(t *testing.T) {
	f := newInitializeCommandFixture(t)
	path := filepath.Join(t.TempDir(), "large-canonical-source.json")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	// Reuse the original large-canonical whitespace fixture; it does not invent
	// or discard historical records, balances, nonces or source policies.
	if _, err = io.Copy(file, io.LimitReader(zeroInitializationSpaces{}, 2<<20)); err == nil {
		_, err = file.Write(f.originals[f.options.migration])
	}
	if closeErr := file.Close(); err != nil || closeErr != nil {
		t.Fatal(err, closeErr)
	}
	measure := func(load func() (chain.ConsensusMigrationState, error)) (chain.ConsensusMigrationState, uint64) {
		t.Helper()
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		got, err := load()
		runtime.ReadMemStats(&after)
		if err != nil {
			t.Fatal(err)
		}
		runtime.KeepAlive(got)
		return got, after.TotalAlloc - before.TotalAlloc
	}
	old, oldBytes := measure(func() (chain.ConsensusMigrationState, error) {
		raw, err := os.ReadFile(path)
		if err != nil {
			return chain.ConsensusMigrationState{}, err
		}
		return oldInitializationMigrationOracle(raw)
	})
	got, streamBytes := measure(func() (chain.ConsensusMigrationState, error) { return readInitializationMigration(path, 1<<30, nil) })
	if !reflect.DeepEqual(old, got) {
		t.Fatal("stream reader changed complete source state/history")
	}
	canonical, err := got.CanonicalJSON()
	if err != nil || !bytes.Equal(canonical, f.originals[f.options.migration]) {
		t.Fatal("stream reader changed any complete original canonical source bytes", err)
	}
	t.Logf("public 2MiB padding fixture: old whole-buffer allocated=%d stream allocated=%d", oldBytes, streamBytes)
	if oldBytes < 4<<20 || streamBytes >= oldBytes/2 {
		t.Fatal("whole-document allocation regression returned", oldBytes, streamBytes)
	}
}
