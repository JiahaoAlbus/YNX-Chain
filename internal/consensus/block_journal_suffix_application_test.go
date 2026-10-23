package consensus

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestPrivateSuffixApplicationMatchesOriginalAndOwnsMigration(t *testing.T) {
	migration, _ := journalFixture(t)
	state := initialCommittedState(migration)
	state.Initialized = true
	if err := state.Validate(migration); err != nil {
		t.Fatal(err)
	}
	control, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	control.committed = state
	candidate, err := newSuffixApplicationForValidatedPrivateState(migration, state)
	if err != nil || !reflect.DeepEqual(control, candidate) {
		t.Fatal("suffix application differs from original initialized application", err)
	}
	// Mutation in either direction must not cross the migration JSON boundary.
	candidate.migration.Accounts[0].Balance++
	candidate.migration.Validators[0].Moniker = "private replay"
	if reflect.DeepEqual(candidate.migration, migration) || !reflect.DeepEqual(control.migration, migration) {
		t.Fatal("replay migration aliases original input")
	}
	migration.Accounts[0].Nonce++
	if candidate.migration.Accounts[0].Nonce == migration.Accounts[0].Nonce {
		t.Fatal("caller migration mutation reached private replay")
	}
}

func TestPrivateSuffixApplicationRejectsInvalidMigration(t *testing.T) {
	migration, _ := journalFixture(t)
	for _, mutate := range []func(*chain.ConsensusMigrationState){
		func(m *chain.ConsensusMigrationState) { m.StateHash = "tampered" },
		func(m *chain.ConsensusMigrationState) { m.Accounts[0].Balance = -1 },
		func(m *chain.ConsensusMigrationState) { m.Validators[0].VotingPower = 0 },
	} {
		raw, err := json.Marshal(migration)
		if err != nil {
			t.Fatal(err)
		}
		var invalid chain.ConsensusMigrationState
		if err := json.Unmarshal(raw, &invalid); err != nil {
			t.Fatal(err)
		}
		mutate(&invalid)
		if _, err := NewApplication(invalid); err == nil {
			t.Fatal("invalid control fixture")
		}
		if got, err := newSuffixApplicationForValidatedPrivateState(invalid, CommittedState{}); err == nil || got != nil {
			t.Fatal("suffix setup omitted full migration validation")
		}
	}
}

// Explicit offline constructor cost only. No submission, nodes or network TPS.
func BenchmarkPrivateSuffixApplicationOriginalMigration(b *testing.B) {
	path := os.Getenv("YNX_SUFFIX_MIGRATION_FIXTURE")
	if path == "" {
		b.Fatal("explicit original migration fixture required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		b.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &migration); err != nil {
		b.Fatal(err)
	}
	state := initialCommittedState(migration)
	state.Initialized = true
	if err := state.Validate(migration); err != nil {
		b.Fatal(err)
	}
	for _, mode := range []string{"control-A", "candidate-B", "candidate-B2", "control-A2"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				var app *Application
				var err error
				if mode == "control-A" || mode == "control-A2" {
					app, err = NewApplication(migration)
					if err == nil {
						app.committed = state
					}
				} else {
					app, err = newSuffixApplicationForValidatedPrivateState(migration, state)
				}
				if err != nil || app == nil {
					b.Fatal(err)
				}
			}
		})
	}
}
