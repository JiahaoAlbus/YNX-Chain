package consensus

import (
	"fmt"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Exact pre-change Validate ordering, reusing the unchanged semantic validator.
// This reference deliberately pays the original two-account-JSON comparison
// before discovering the actual existing application records.
func validateLegacyAnchorFirst(s CommittedState, migration chain.ConsensusMigrationState) error {
	if err := s.validateSemantics(migration); err != nil {
		return err
	}
	expected := migration.StateHash
	if !accountsEqual(s.Accounts, migration.Accounts) || s.hasApplicationRecords() {
		var err error
		expected, err = s.calculateHash()
		if err != nil {
			return err
		}
	}
	if !strings.EqualFold(s.AppHash, expected) {
		return fmt.Errorf("committed app hash mismatch: expected %s", expected)
	}
	return nil
}

func TestStateAnchorRecordShortCircuitPreservesValidation(t *testing.T) {
	migration, fixture := retainedSealFixture(t)
	for _, name := range []string{"actual_history", "anchor_only", "tampered_hash", "late_fee_audit", "supply", "uninitialized_records"} {
		t.Run(name, func(t *testing.T) {
			state := fixture
			state.Accounts = cloneAccounts(fixture.Accounts)
			state.FeeEvents = append([]BFTFeeEvent(nil), fixture.FeeEvents...)
			switch name {
			case "anchor_only":
				state = initialCommittedState(migration)
			case "tampered_hash":
				state.AppHash = strings.Repeat("0", 64)
			case "late_fee_audit":
				state.FeeEvents[1023].AuditHash = "tampered"
			case "supply":
				state.Accounts[0].Balance++
			case "uninitialized_records":
				state.Initialized = false
			}
			before := validateLegacyAnchorFirst(state, migration)
			after := state.Validate(migration)
			if (before == nil) != (after == nil) || (before != nil && before.Error() != after.Error()) {
				t.Fatalf("validation or first error changed: before=%v after=%v", before, after)
			}
			if name != "actual_history" && name != "anchor_only" && after == nil {
				t.Fatal("invalid retained state accepted")
			}
		})
	}
}

// Full semantic validation and the exact complete current-state hash execute in
// both modes, on one retained actual 1024-transfer state and matching anchor.
// This is a validation-cost microbenchmark, never a business/network TPS claim.
func BenchmarkStateAnchorComparison(b *testing.B) {
	migration, state := retainedSealFixture(b)
	for _, mode := range []struct {
		name     string
		validate func(CommittedState, chain.ConsensusMigrationState) error
	}{
		{"legacy_anchor_first", validateLegacyAnchorFirst},
		{"records_first", func(s CommittedState, m chain.ConsensusMigrationState) error { return s.Validate(m) }},
	} {
		b.Run(mode.name, func(b *testing.B) {
			if err := mode.validate(state, migration); err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if err := mode.validate(state, migration); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
