package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

// Use the original normal producer and real pinned constructor. A reference
// represents the complete sidecar; it does not supply that state or authority.
func bootstrapMatchesStreamReference(t *testing.T, m chain.ConsensusMigrationState, genesisTime time.Time, canonical []byte) *ConsensusBootstrap {
	t.Helper()
	doc, err := BuildCometGenesis(m, genesisTime)
	if err != nil {
		t.Fatal(err)
	}
	doc.AppState, err = json.Marshal(newCometMigrationReference(m, canonical))
	if err != nil {
		t.Fatal(err)
	}
	genesis, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	pins := ConsensusBootstrapPins{productionOperatorSHA(genesis), m.OriginalGenesisHash, m.StateHash}
	b, err := NewConsensusBootstrap(genesis, pins, m)
	if err != nil || b == nil || b.migrationReference == nil {
		t.Fatal("normal constructor did not retain exact complete reference", err)
	}
	return b
}

func TestBootstrapMatchesMigrationStreamReferenceCompleteBinding(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	b := bootstrapMatchesStreamReference(t, f.migration, f.doc.GenesisTime, canonical)
	if err := b.matchesMigration(f.migration); err != nil {
		t.Fatal("exact complete original migration refused", err)
	}
	for i := 0; i < reflect.TypeOf(*b.migrationReference).NumField(); i++ {
		name := reflect.TypeOf(*b.migrationReference).Field(i).Name
		t.Run("reference-"+name, func(t *testing.T) {
			copy := *b
			reference := *b.migrationReference
			v := reflect.ValueOf(&reference).Elem().Field(i)
			v.SetString("changed-" + v.String())
			copy.migrationReference = &reference
			if err := copy.matchesMigration(f.migration); err == nil {
				t.Fatal("matchesMigration omitted original reference binding", name)
			}
		})
	}
	for name, mutate := range map[string]func(*chain.ConsensusMigrationState){
		"version":        func(m *chain.ConsensusMigrationState) { m.Version++ },
		"source-format":  func(m *chain.ConsensusMigrationState) { m.SourceFormat += "-foreign" },
		"network":        func(m *chain.ConsensusMigrationState) { m.Network.Name += "-foreign" },
		"native-genesis": func(m *chain.ConsensusMigrationState) { m.OriginalGenesisHash = strings.Repeat("a", 64) },
		"state-hash":     func(m *chain.ConsensusMigrationState) { m.StateHash = strings.Repeat("b", 64) },
		"height":         func(m *chain.ConsensusMigrationState) { m.Height++ },
		"last-block":     func(m *chain.ConsensusMigrationState) { m.LastBlockHash = strings.Repeat("c", 64) },
		"validator":      func(m *chain.ConsensusMigrationState) { m.Validators[len(m.Validators)-1].Moniker += "-foreign" },
		"validator-key": func(m *chain.ConsensusMigrationState) {
			m.Validators[len(m.Validators)-1].ConsensusAddress = strings.Repeat("D", 40)
		},
		"runtime-root": func(m *chain.ConsensusMigrationState) { m.Runtime.StateIntegrity = strings.Repeat("e", 64) },
		"runtime-metadata": func(m *chain.ConsensusMigrationState) {
			m.Runtime.SavedAt = m.Runtime.SavedAt.Add(time.Nanosecond)
		},
		"history-tail": func(m *chain.ConsensusMigrationState) {
			m.Runtime.Blocks[len(m.Runtime.Blocks)-1].Hash = strings.Repeat("f", 64)
		},
	} {
		t.Run("state-"+name, func(t *testing.T) {
			var changed chain.ConsensusMigrationState
			if err := json.Unmarshal(canonical, &changed); err != nil {
				t.Fatal(err)
			}
			mutate(&changed)
			if err := b.matchesMigration(changed); err == nil {
				t.Fatal("stream matching accepted changed complete source", name)
			}
		})
	}
}

func TestBootstrapMatchesMigrationStreamInlineEveryByteAndNil(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	if f.bootstrap.migrationReference != nil || len(f.bootstrap.appState) == 0 || len(f.bootstrap.appState) > 128<<10 {
		t.Fatal("original small inline fixture changed scope")
	}
	if err := f.bootstrap.matchesMigration(f.migration); err != nil {
		t.Fatal(err)
	}
	copy := *f.bootstrap
	copy.appState = bytes.Clone(f.bootstrap.appState)
	// The actual matchesMigration entrypoint must compare every embedded byte,
	// including the first and last byte, rather than relying on count/digest.
	for i := range copy.appState {
		copy.appState[i] ^= 1
		err := copy.matchesMigration(f.migration)
		copy.appState[i] ^= 1
		if err == nil {
			t.Fatal("stream accepted changed embedded byte", i)
		}
	}
	for _, bad := range [][]byte{nil, f.bootstrap.appState[:len(f.bootstrap.appState)-1], append(bytes.Clone(f.bootstrap.appState), ' ')} {
		copy.appState = bad
		if err := copy.matchesMigration(f.migration); err == nil {
			t.Fatal("stream accepted missing, truncated or extended inline state")
		}
	}
	var missing *ConsensusBootstrap
	if err := missing.matchesMigration(f.migration); err == nil {
		t.Fatal("nil bootstrap granted complete-state matching")
	}
	if !bytes.Equal(f.bootstrap.appState, f.doc.AppState) {
		t.Fatal("comparison mutated the immutable original bootstrap")
	}
	t.Logf("PUBLIC compared every byte of %d-byte original inline state; no memory peak measurement", len(f.bootstrap.appState))
}

func TestBootstrapMatchesMigrationStreamLargeOriginalHistory(t *testing.T) {
	// Reuse the existing real >64MiB producer fixture exactly once. There is no
	// padded field, fake history, Node.Start, external data, or memory-peak claim.
	f := newValidatorRegistryFixture(t)
	m, _ := largeReferenceMigration(t, f.migration)
	var bindings []chain.ConsensusValidatorKeyBinding
	for _, v := range f.migration.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address,
			KeyType: v.ConsensusKeyType, PublicKey: v.ConsensusPubKey, ConsensusAddress: v.ConsensusAddress})
	}
	var err error
	m, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := m.CanonicalJSON()
	if err != nil || len(canonical) <= MaxCometGenesisBytes || len(canonical) > 80<<20 {
		t.Fatal("original valid source did not reach unchanged large-input boundary", err)
	}
	count, digest := len(canonical), sha256.Sum256(canonical)
	b := bootstrapMatchesStreamReference(t, m, f.doc.GenesisTime, canonical)
	if b.migrationReference.MigrationCanonicalSHA256 != hex.EncodeToString(digest[:]) || b.migrationReference.MigrationCanonicalBytes != strconv.Itoa(count) {
		t.Fatal("reference changed old canonical digest or complete byte count")
	}
	canonical = nil // Drop the test oracle before the actual complete-state call.
	if err = b.matchesMigration(m); err != nil {
		t.Fatal("complete original history rejected by actual matching entrypoint", err)
	}
	last := len(m.Runtime.Blocks) - 1
	if last < 0 || len(m.Runtime.Blocks[last].Transactions) == 0 {
		t.Fatal("normal large fixture has no final history transaction")
	}
	at := len(m.Runtime.Blocks[last].Transactions) - 1
	originalMemo := m.Runtime.Blocks[last].Transactions[at].Memo
	m.Runtime.Blocks[last].Transactions[at].Memo = originalMemo + "unbound-final-history-byte"
	if err = b.matchesMigration(m); err == nil {
		t.Fatal("stream skipped final retained transaction history")
	}
	m.Runtime.Blocks[last].Transactions[at].Memo = originalMemo
	if err = b.matchesMigration(m); err != nil {
		t.Fatal("failed comparison mutated complete source or bootstrap", err)
	}
	t.Logf("PUBLIC normal full history canonicalBytes=%d sha256=%x; semantic before/after equivalence only, not allocation or peak RSS", count, digest)
}
