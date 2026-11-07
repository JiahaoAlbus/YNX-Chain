//go:build unix

package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestPQLabLiveColdOwnerSameOriginalFullBoundary(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	raw, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	_, migration, _, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"inline", "reference"} {
		t.Run(kind, func(t *testing.T) {
			input := bytes.Clone(raw)
			if kind == "reference" {
				canonical, err := migration.CanonicalJSON()
				if err != nil {
					t.Fatal(err)
				}
				var doc cmttypes.GenesisDoc
				if err := cmtjson.Unmarshal(input, &doc); err != nil {
					t.Fatal(err)
				}
				doc.AppState, _ = json.Marshal(newCometMigrationReference(migration, canonical))
				input, err = cmtjson.MarshalIndent(doc, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
			}
			pins := p.pins()
			pins.CometGenesisSHA256 = pqLabSHA(input)
			start := time.Now()
			before, err := NewConsensusBootstrap(input, pins, migration)
			if err != nil {
				t.Fatal(err)
			}
			old, err := newValidatedMigration(migration, before)
			oldNS := time.Since(start).Nanoseconds()
			if err != nil {
				t.Fatal(err)
			}
			metrics := &PQLabMetrics{}
			start = time.Now()
			after, err := newPQLabLiveBootstrap(input, pins, migration, metrics)
			newNS := time.Since(start).Nanoseconds()
			if err != nil {
				t.Fatal(err)
			}
			if old.canonicalHash != after.canonicalHash || old.canonicalBytes != after.canonicalBytes || !reflect.DeepEqual(old.migration, after.migration) || !reflect.DeepEqual(old.bootstrap.record, after.bootstrap.record) || !bytes.Equal(old.bootstrap.rawGenesis, after.bootstrap.rawGenesis) {
				t.Fatal("cold live owner changed complete source/bootstrap")
			}
			if metrics.Snapshot().Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || after.validatedSelf != after || after.bootstrapKeysValidated != after {
				t.Fatal("full private owner not constructed exactly once")
			}
			t.Logf("LIVE_COLD_OWNER kind=%s oldFullBoundaryNS=%d newFullBoundaryNS=%d canonicalBytes=%d sameOriginal=true syntheticOnly=true fullChain=false", kind, oldNS, newNS, after.canonicalBytes)
		})
	}
}

func TestPQLabLiveColdOwnerNormalizationAndEncodingFirstCause(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	raw, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	_, original, _, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"normalized-reference", "normalized-bad-json", "encoding-error-bad-json"} {
		t.Run(kind, func(t *testing.T) {
			m := original
			// Detach the fixture first so each branch starts with independent values.
			b, err := json.Marshal(original)
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatal(err)
			}
			m.Network.Name = "source invalid \xff"
			m.Runtime.Config = m.Network
			if kind == "encoding-error-bad-json" {
				m.Runtime.Blocks[1].Time = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
			}
			m.StateHash = ""
			b, encodeErr := json.Marshal(m)
			if encodeErr == nil {
				m.StateHash = pqLabSHA(b)
			} else {
				// Keep the independent pin well formed so the original complete
				// migration validator, not an empty-hash parser, sees the bad time.
				m.StateHash = original.StateHash
			}
			if kind != "encoding-error-bad-json" {
				if err := m.ValidateConsensusValidatorKeys(); err != nil {
					t.Fatal("normalization must pass original complete validator", err)
				}
			} else if m.ValidateConsensusValidatorKeys() == nil {
				t.Fatal("encoding error must be rejected by original full validation")
			}
			pins := p.pins()
			pins.MigrationStateHash = m.StateHash
			input := []byte("{")
			if kind == "normalized-reference" {
				canonical, err := m.CanonicalJSON()
				if err != nil {
					t.Fatal(err)
				}
				var doc cmttypes.GenesisDoc
				if err := cmtjson.Unmarshal(raw, &doc); err != nil {
					t.Fatal(err)
				}
				doc.AppState, _ = json.Marshal(newCometMigrationReference(m, canonical))
				doc.AppHash, err = hex.DecodeString(m.StateHash)
				if err != nil {
					t.Fatal(err)
				}
				input, err = cmtjson.MarshalIndent(doc, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
			}
			pins.CometGenesisSHA256 = pqLabSHA(input)
			oldBootstrap, oldErr := NewConsensusBootstrap(input, pins, m)
			var old *validatedMigration
			if oldErr == nil {
				old, oldErr = newValidatedMigration(m, oldBootstrap)
			}
			current, newErr := newPQLabLiveBootstrap(input, pins, m, nil)
			if kind == "encoding-error-bad-json" && (oldErr == nil || !strings.HasPrefix(oldErr.Error(), "bootstrap bound migration:") || !strings.Contains(oldErr.Error(), "Time.MarshalJSON") || !strings.Contains(oldErr.Error(), "year outside")) {
				t.Fatal("encoding fixture did not reach original full migration validation", oldErr)
			}
			if (oldErr == nil) != (newErr == nil) || oldErr != nil && oldErr.Error() != newErr.Error() {
				t.Fatal("normalization/encoding original first cause changed", oldErr, newErr)
			}
			if oldErr == nil && (old.canonicalHash != current.canonicalHash || old.canonicalBytes != current.canonicalBytes || !reflect.DeepEqual(old.migration, current.migration)) {
				t.Fatal("normalized private owner differs")
			}
		})
	}
}

func TestPQLabLiveColdOwnerPreservesOriginalFirstCause(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	raw, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	_, migration, _, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"both-genesis-and-migration", "migration", "bad-json", "bad-appstate", "unbound"} {
		t.Run(kind, func(t *testing.T) {
			input := bytes.Clone(raw)
			pins := p.pins()
			m := migration
			switch kind {
			case "both-genesis-and-migration":
				input[0] ^= 1
				m.StateHash = "invalid"
			case "migration":
				m.StateHash = "invalid"
			case "bad-json":
				input = []byte("{")
				pins.CometGenesisSHA256 = pqLabSHA(input)
			case "bad-appstate":
				var doc cmttypes.GenesisDoc
				if err := cmtjson.Unmarshal(input, &doc); err != nil {
					t.Fatal(err)
				}
				doc.AppState = json.RawMessage(`{"version":"wrong"}`)
				input, err = cmtjson.MarshalIndent(doc, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
				pins.CometGenesisSHA256 = pqLabSHA(input)
			case "unbound":
				m = chain.ConsensusMigrationState{}
			}
			_, oldErr := NewConsensusBootstrap(input, pins, m)
			owner, newErr := newPQLabLiveBootstrap(input, pins, m, nil)
			if oldErr == nil || newErr == nil || oldErr.Error() != newErr.Error() || owner != nil {
				t.Fatal("cold owner changed original first failure or published partial state", oldErr, newErr)
			}
		})
	}
}
