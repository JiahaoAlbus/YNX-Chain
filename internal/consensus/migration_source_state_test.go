package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestLegacySourceCommitRejectsRemovalRewriteAndLateImport(t *testing.T) {
	anchor := strings.Repeat("a", 64)
	previous := CommittedState{Version: 18, Height: 2, AppHash: anchor,
		LegacyPaySource: &LegacyPaySource{SourceAnchor: anchor},
		LegacyAISource:  &LegacyAISource{SourceAnchor: anchor},
		LegacyTrustSource: &LegacyTrustSource{SourceAnchor: anchor, SourceHeight: 1, SourceChainID: 6423,
			Updates: []LegacyTrustSourceUpdate{{Transaction: []byte("original signed bytes"), TransactionHash: anchor}}}}
	clone := func() CommittedState {
		value := previous
		value.Height++
		value.LegacyPaySource = cloneLegacyPaySource(value.LegacyPaySource)
		value.LegacyAISource = cloneLegacyAISource(value.LegacyAISource)
		value.LegacyTrustSource = cloneLegacyTrustSource(value.LegacyTrustSource)
		return value
	}
	for name, mutate := range map[string]func(*CommittedState){
		"pay_removed":              func(s *CommittedState) { s.LegacyPaySource = nil },
		"pay_anchor":               func(s *CommittedState) { s.LegacyPaySource.SourceAnchor = strings.Repeat("b", 64) },
		"ai_removed":               func(s *CommittedState) { s.LegacyAISource = nil },
		"ai_anchor":                func(s *CommittedState) { s.LegacyAISource.SourceAnchor = strings.Repeat("b", 64) },
		"trust_removed":            func(s *CommittedState) { s.LegacyTrustSource = nil },
		"trust_truncated":          func(s *CommittedState) { s.LegacyTrustSource.Updates = nil },
		"trust_original_rewritten": func(s *CommittedState) { s.LegacyTrustSource.Updates[0].Transaction[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			next := clone()
			mutate(&next)
			path := filepath.Join(t.TempDir(), "committed.json")
			a := &Application{committed: previous, pending: &next, statePath: path}
			if _, err := a.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
				t.Fatal("Commit accepted a rewritten imported history")
			}
			if !reflect.DeepEqual(a.committed, previous) || a.pending != &next {
				t.Fatal("rejected Commit lost its original state or pending fence")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("rejected Commit wrote a replacement state", err)
			}
		})
	}
	next := clone()
	if err := validateLegacySourceContinuation(previous, next); err != nil {
		t.Fatal("unchanged original source was refused", err)
	}
	previous.LegacyTrustSource = nil
	if err := validateLegacySourceContinuation(previous, next); err == nil {
		t.Fatal("new source import appeared after initialization")
	}
}

func TestLegacySourceNilFieldsPreserveExistingHashDocuments(t *testing.T) {
	for _, version := range []int{13, 14, 15, 16, 17, 18, 19, 20} {
		s := CommittedState{Version: version, ChainID: 6423, MigrationStateHash: strings.Repeat("a", 64)}
		doc := s.hashDocument("YNX_ABCI_STATE_V"+strconv.Itoa(version), version)
		wire, err := json.Marshal(doc)
		if err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"legacyPaySource", "legacyAISource", "legacyTrustSource"} {
			if strings.Contains(string(wire), `"`+field+`"`) {
				t.Fatal("nil source changed an existing canonical document", version, field)
			}
		}
		if err := validateHistoricalStateFields(s, chain.ConsensusMigrationState{}); err != nil {
			t.Fatal(err)
		}
		s.LegacyAISource = &LegacyAISource{SourceAnchor: s.MigrationStateHash}
		if version < 18 {
			if validateHistoricalStateFields(s, chain.ConsensusMigrationState{}) == nil {
				t.Fatal("old hash domain accepted uncommitted source fields", version)
			}
			continue
		}
		nextWire, err := json.Marshal(s.hashDocument(doc.Domain, version))
		if err != nil || string(nextWire) == string(wire) || !strings.Contains(string(nextWire), `"legacyAISource"`) {
			t.Fatal("new source was omitted from the current hash document", version, err)
		}
	}
}

func TestLegacySourceCompatibilityDistinguishesPreservationFromAuthority(t *testing.T) {
	f := newLegacyAISourceFixture(t)
	find := func(m chain.ConsensusMigrationState) MigrationModuleBlocker {
		for _, blocker := range MigrationExecutionBlockers(m) {
			if blocker.Module == "ai" {
				return blocker
			}
		}
		t.Fatal("source AI authority blocker disappeared")
		return MigrationModuleBlocker{}
	}
	valid := find(f.m)
	if !strings.Contains(valid.Reason, "source preservation validation passed;") || !strings.Contains(valid.Reason, "no signed principal") {
		t.Fatal("preservation was confused with signing authority", valid)
	}
	// Damaged source isolation: never submitted as a trusted migration. Even the
	// offline compatibility path must execute the real original-domain checks.
	permission := f.m.Runtime.AIPerms[f.permission]
	permission.AuditHash = strings.Repeat("0", 64)
	f.m.Runtime.AIPerms[f.permission] = permission
	invalid := find(f.m)
	if !strings.Contains(invalid.Reason, "source preservation validation failed:") || invalid.Records != valid.Records {
		t.Fatal("damaged source was erased or reported as preserved", invalid)
	}
}
