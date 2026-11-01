package consensus

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

// Fresh PUBLIC native accounts, nonce, executed contract and history fixture.
// No public-network state, private custody, Node.Start or resource cap changes.
func TestInitializeApplicationPUBLICSingleOwnedWitness(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			before := validatedMigrationFullChecks.Load()
			result, err := InitializeApplication(f.migration, f.raw, f.pins, ApplicationInitializationOptions{StatePath: filepath.Join(t.TempDir(), "new", "state"), StateLayout: layout})
			if err != nil || !result.ColdReadVerified || result.Initialized || result.Deployed || result.PQActivated {
				t.Fatal("normal complete initialization failed", err)
			}
			if calls := validatedMigrationFullChecks.Load() - before; calls != 1 {
				t.Fatalf("normal initialization cloned/validated complete original history %d times; want exactly one original private owner", calls)
			}
		})
	}
}

func TestInitializeApplicationPUBLICDetachedCallerAfterReservation(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	original, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	frozen, err := chain.ReadConsensusMigrationState(bytes.NewReader(original))
	if err != nil {
		t.Fatal(err)
	}
	options := ApplicationInitializationOptions{StatePath: filepath.Join(t.TempDir(), "new", "state.blocks"), StateLayout: "block-journal"}
	hooks := &applicationInitializationHooks{afterReservation: func(string) error {
		// After the only complete source was privately detached, a mutable caller
		// must not change later constructors or the normal persisted cold read.
		f.migration.Accounts[0].Balance++
		f.migration.Runtime.Blocks[0].Hash = "PUBLIC-caller-mutated-after-ownership"
		return nil
	}}
	before := validatedMigrationFullChecks.Load()
	result, err := initializeApplication(f.migration, f.raw, f.pins, options, hooks)
	if err != nil || !result.ColdReadVerified {
		t.Fatal("owned initializer reread mutable caller input", err)
	}
	if got := validatedMigrationFullChecks.Load() - before; got != 1 {
		t.Fatal("detached initializer rebuilt private source", got)
	}
	cold, err := openInitializedApplication(frozen, options, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := cold.Query(context.Background(), &abci.RequestQuery{Path: "/migration"})
	if err != nil || reply.Code != 0 || !bytes.Equal(reply.Value, original) {
		t.Fatal("owned cold source differs from original full history", err)
	}
	if cold.committed.LegacyContracts == nil || len(cold.committed.Contracts) != 1 || !accountsEqual(cold.committed.Accounts, frozen.Accounts) {
		t.Fatal("account/nonce/contract preservation changed")
	}
	// The existing checkpoint/frame encoders have not changed. Compare exactly
	// to their original normal initial-state format, including every header byte.
	expected, err := NewPersistentApplicationWithBootstrap(frozen, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := encodeBlockCheckpoint(expected.committed)
	if err != nil {
		t.Fatal(err)
	}
	want := append([]byte(blockJournalMagic+frozen.StateHash+"\n"), blockJournalFrame(payload)...)
	want = append(want, payload...)
	actual, err := os.ReadFile(options.StatePath)
	if err != nil || !bytes.Equal(want, actual) {
		t.Fatal("normal block journal serialized bytes changed", err)
	}
}

func TestInitializeApplicationPUBLICOwnedJournalColdGuards(t *testing.T) {
	f := validatedMigrationFixture(t)
	witness, err := newValidatedMigration(f.migration, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "new", "state.blocks")
	options := ApplicationInitializationOptions{StatePath: path, StateLayout: "block-journal"}
	before := validatedMigrationFullChecks.Load()
	first, err := openInitializedApplicationOwned(witness, options)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := openInitializedApplicationOwned(witness, options)
	if err != nil {
		t.Fatal(err)
	}
	if first.validatedMigration != witness || cold.validatedMigration != witness || first.bootstrap != witness.bootstrap || cold.committed.bootstrap != witness.bootstrap || validatedMigrationFullChecks.Load() != before {
		t.Fatal("private cold constructors copied or substituted original source")
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"complete-frame-invalid-state", "incomplete-tail"} {
		t.Run(kind, func(t *testing.T) {
			var bad []byte
			if kind == "incomplete-tail" {
				bad = append(bytes.Clone(original), make([]byte, 32)...)
			} else {
				invalid := first.committed
				invalid.Accounts = cloneAccounts(invalid.Accounts)
				invalid.Accounts[0].Balance++
				payload, err := encodeBlockCheckpoint(invalid)
				if err != nil {
					t.Fatal(err)
				}
				bad = append([]byte(blockJournalMagic+f.migration.StateHash+"\n"), blockJournalFrame(payload)...)
				bad = append(bad, payload...)
			}
			if err := os.WriteFile(path, bad, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := openInitializedApplicationOwned(witness, options); err == nil {
				t.Fatal("same witness bypassed actual cold state/tail verification")
			}
			retained, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(bad, retained) {
				t.Fatal("refused cold read rewrote or truncated original partial", err)
			}
		})
	}
	absent := filepath.Join(t.TempDir(), "not-created", "state")
	if _, err := openInitializedApplicationOwned(nil, ApplicationInitializationOptions{StatePath: absent, StateLayout: "block-journal"}); err == nil {
		t.Fatal("missing private source accepted")
	}
	if _, err := os.Stat(filepath.Dir(absent)); !os.IsNotExist(err) {
		t.Fatal("missing source reserved a destination")
	}
}
