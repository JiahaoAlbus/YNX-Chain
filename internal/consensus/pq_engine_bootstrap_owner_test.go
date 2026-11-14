package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This is the existing immutable PUBLIC trace. No keygen, signing, node or
// authority fixture is created by these controls.
func bootstrapPreparationPUBLIC(t *testing.T) (PQLabFinalizeTrace, chain.ConsensusMigrationState, []byte, []byte, []byte) {
	t.Helper()
	dir := filepath.Join("..", "..", "scripts", "loadtest", "fixtures", "finalize-1b-public")
	raw, err := os.ReadFile(filepath.Join(dir, "result.json"))
	if err != nil || pqLabSHA(raw) != "11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6" {
		t.Fatal("fixed original PUBLIC trace required", err)
	}
	var trace PQLabFinalizeTrace
	if err := json.Unmarshal(raw, &trace); err != nil || !trace.SyntheticOnly || trace.AuthorityGranted || trace.NodeStarted || trace.PublicNetwork {
		t.Fatal("PUBLIC trace boundary", err)
	}
	read := func(f PQLabFinalizeTraceFile) []byte {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(dir, f.Name))
		if err != nil || int64(len(b)) != f.Bytes || pqLabSHA(b) != f.SHA256 {
			t.Fatal("original PUBLIC material differs", f.Name, err)
		}
		return b
	}
	m, err := chain.ReadConsensusMigrationState(bytes.NewReader(read(trace.Migration)))
	if err != nil {
		t.Fatal(err)
	}
	return trace, m, read(trace.Genesis), read(trace.Schedule), read(trace.FinalState)
}

func preparationGenesis(t *testing.T, raw []byte, m chain.ConsensusMigrationState, reference bool) []byte {
	t.Helper()
	var doc cmttypes.GenesisDoc
	if err := cmtjson.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	canonical, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	doc.AppState = canonical
	if reference {
		doc.AppState, err = json.Marshal(newCometMigrationReference(m, canonical))
	}
	if err != nil {
		t.Fatal(err)
	}
	doc.AppHash, err = hex.DecodeString(m.StateHash)
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmtjson.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestPQEngineBootstrapPreparationPUBLICOriginalAndDetached(t *testing.T) {
	trace, migration, raw, schedule, _ := bootstrapPreparationPUBLIC(t)
	for _, reference := range []bool{false, true} {
		name := "embedded"
		if reference {
			name = "reference"
		}
		t.Run(name, func(t *testing.T) {
			input := preparationGenesis(t, raw, migration, reference)
			pins := trace.Pins
			pins.CometGenesisSHA256 = pqLabSHA(input)
			old, err := NewConsensusBootstrap(input, pins, migration)
			if err != nil {
				t.Fatal(err)
			}
			original, err := newValidatedMigration(migration, old)
			if err != nil {
				t.Fatal(err)
			}
			count := validatedMigrationFullChecks.Load()
			prepared, err := PreparePQEngineBootstrap(input, pins, migration)
			if err != nil {
				t.Fatal(err)
			}
			if validatedMigrationFullChecks.Load()-count != 1 {
				t.Fatal("private full owner must be built once")
			}
			if prepared.owner.canonicalHash != original.canonicalHash || prepared.owner.canonicalBytes != original.canonicalBytes || !reflect.DeepEqual(prepared.owner.migration, original.migration) || !reflect.DeepEqual(prepared.owner.bootstrap, original.bootstrap) {
				t.Fatal("complete original migration/bootstrap changed")
			}
			view, err := prepared.Bootstrap()
			if err != nil {
				t.Fatal(err)
			}
			view.rawGenesis[0] ^= 1
			view.record.Members[0].Address[0] ^= 1
			*view = ConsensusBootstrap{}
			input[0] ^= 1
			fresh, err := prepared.Bootstrap()
			if err != nil || !reflect.DeepEqual(fresh, original.bootstrap) {
				t.Fatal("exported view/input aliased private owner", err)
			}
			auth, err := NewPQEngineAuthorization(schedule, trace.ScheduleHash)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := prepared.FileSource(filepath.Join(t.TempDir(), "state"), auth, nil); err != nil {
				t.Fatal(err)
			}
			if validatedMigrationFullChecks.Load()-count != 1 {
				t.Fatal("source repeated static migration validation")
			}
		})
	}
	prepared, err := PreparePQEngineBootstrap(raw, trace.Pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	originalHash := prepared.owner.migration.StateHash
	migration.Accounts[0].Balance++
	migration.Runtime.Config.Name += "changed"
	if prepared.owner.migration.StateHash != originalHash || reflect.DeepEqual(migration, prepared.owner.migration) {
		t.Fatal("typed source escaped detachment")
	}
	copyValue := *prepared
	for _, invalid := range []*PQEngineBootstrapPreparation{nil, {}, &copyValue} {
		if _, err := invalid.Bootstrap(); err == nil {
			t.Fatal("absent/copied owner accepted")
		}
		if _, err := invalid.FileSource("state", nil, nil); err == nil {
			t.Fatal("absent/copied owner produced source")
		}
	}
}

func TestPQEngineBootstrapPreparationPUBLICFirstCause(t *testing.T) {
	trace, migration, raw, _, _ := bootstrapPreparationPUBLIC(t)
	for _, kind := range []string{"root-and-migration", "migration", "pin-shape", "genesis-json", "reference-digest", "reference-count", "reference-metadata", "embedded-mismatch", "normalized-reference", "normalization-invalid-json", "encoding-first"} {
		t.Run(kind, func(t *testing.T) {
			m := migration
			wire, _ := json.Marshal(migration)
			if err := json.Unmarshal(wire, &m); err != nil {
				t.Fatal(err)
			}
			input, pins := bytes.Clone(raw), trace.Pins
			switch kind {
			case "root-and-migration":
				input[0] ^= 1
				m.StateHash = "invalid"
			case "migration":
				m.StateHash = "invalid"
			case "pin-shape":
				pins.MigrationStateHash = "invalid"
			case "genesis-json":
				input = []byte("{")
				pins.CometGenesisSHA256 = pqLabSHA(input)
			case "reference-digest", "reference-count", "reference-metadata", "embedded-mismatch":
				input = preparationGenesis(t, raw, m, kind != "embedded-mismatch")
				var doc cmttypes.GenesisDoc
				if err := cmtjson.Unmarshal(input, &doc); err != nil {
					t.Fatal(err)
				}
				if kind == "embedded-mismatch" {
					doc.AppState = bytes.Replace(doc.AppState, []byte(m.StateHash), []byte(strings.Repeat("1", 64)), 1)
				} else {
					var ref cometMigrationReference
					if err := json.Unmarshal(doc.AppState, &ref); err != nil {
						t.Fatal(err)
					}
					switch kind {
					case "reference-digest":
						ref.MigrationCanonicalSHA256 = strings.Repeat("1", 64)
					case "reference-count":
						ref.MigrationCanonicalBytes = "1"
					case "reference-metadata":
						ref.MigrationLastBlockHash = strings.Repeat("2", 64)
					}
					doc.AppState, _ = json.Marshal(ref)
				}
				input, _ = cmtjson.MarshalIndent(doc, "", "  ")
				pins.CometGenesisSHA256 = pqLabSHA(input)
			case "normalized-reference", "normalization-invalid-json", "encoding-first":
				m.Network.Name = "original invalid \xff"
				m.Runtime.Config = m.Network
				if kind == "encoding-first" {
					m.Runtime.Blocks[1].Time = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
				}
				m.StateHash = ""
				wire, err := json.Marshal(m)
				if err == nil {
					m.StateHash = pqLabSHA(wire)
				} else {
					m.StateHash = migration.StateHash
				}
				pins.MigrationStateHash = m.StateHash
				input = []byte("{")
				if kind == "normalized-reference" {
					input = preparationGenesis(t, raw, m, true)
				}
				pins.CometGenesisSHA256 = pqLabSHA(input)
			}
			old, before := NewConsensusBootstrap(input, pins, m)
			if before == nil {
				_, before = newValidatedMigration(m, old)
			}
			after, got := PreparePQEngineBootstrap(input, pins, m)
			if (before == nil) != (got == nil) || before != nil && before.Error() != got.Error() {
				t.Fatal("original first cause changed", before, got)
			}
			if kind != "normalized-reference" && (before == nil || after != nil) {
				t.Fatal("malicious input accepted/published partial owner")
			}
			if kind == "normalized-reference" && (before != nil || after == nil) {
				t.Fatal("original accepted normalization refused", before, got)
			}
		})
	}
}

func TestPQEngineBootstrapPreparationPUBLICDynamicStateAndRuntime(t *testing.T) {
	trace, migration, raw, schedule, state := bootstrapPreparationPUBLIC(t)
	prepared, err := PreparePQEngineBootstrap(raw, trace.Pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(schedule, trace.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, state, 0600); err != nil {
		t.Fatal(err)
	}
	view, _ := prepared.Bootstrap()
	old, err := NewPQEngineFileSource(migration, path, view, auth)
	if err != nil {
		t.Fatal(err)
	}
	newSource, err := prepared.FileSource(path, auth, nil)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := hex.DecodeString(trace.EngineAppHash)
	want, err := old.ConsensusAuthorityForState(trace.ChainID, trace.LastHeight, hash)
	if err != nil {
		t.Fatal(err)
	}
	got, err := newSource.ConsensusAuthorityForState(trace.ChainID, trace.LastHeight, hash)
	if err != nil {
		t.Fatal(err)
	}
	oldPolicy, _ := want.(*PQEngineSnapshot).Policy()
	newPolicy, _ := got.(*PQEngineSnapshot).Policy()
	if !reflect.DeepEqual(oldPolicy, newPolicy) || !reflect.DeepEqual(want.(*PQEngineSnapshot).Anchor(), got.(*PQEngineSnapshot).Anchor()) {
		t.Fatal("dynamic full authority differs")
	}
	for _, mode := range []string{"height", "hash", "chain", "replaced-state", "schedule"} {
		t.Run(mode, func(t *testing.T) {
			h, height, chainID, authorization := bytes.Clone(hash), trace.LastHeight, trace.ChainID, auth
			switch mode {
			case "height":
				height--
			case "hash":
				h[0] ^= 1
			case "chain":
				chainID += "other"
			case "replaced-state":
				if err := os.WriteFile(path, []byte("{}"), 0600); err != nil {
					t.Fatal(err)
				}
				defer os.WriteFile(path, state, 0600)
			case "schedule":
				authorization = &PQEngineAuthorization{}
			}
			a, e1 := NewPQEngineFileSource(migration, path, view, authorization)
			if e1 == nil {
				_, e1 = a.ConsensusAuthorityForState(chainID, height, h)
			}
			b, e2 := prepared.FileSource(path, authorization, nil)
			if e2 == nil {
				_, e2 = b.ConsensusAuthorityForState(chainID, height, h)
			}
			if e1 == nil || e2 == nil || e1.Error() != e2.Error() {
				t.Fatal("dynamic refusal/first cause changed", e1, e2)
			}
		})
	}
	// A separately pinned historical runtime plan still uses its original
	// complete constructor, independent pin and source binding.
	var doc cmttypes.GenesisDoc
	if err := cmtjson.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	doc.ConsensusParams.Version.App = 19
	input, _ := cmtjson.MarshalIndent(doc, "", "  ")
	pins := trace.Pins
	pins.CometGenesisSHA256 = pqLabSHA(input)
	p, err := PreparePQEngineBootstrap(input, pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := p.Bootstrap()
	plan := RuntimeUpgradePlan{Format: RuntimeUpgradePlanFormat, ChainID: trace.ChainID, NativeChainID: migration.Network.ChainID, CometGenesisSHA256: pins.CometGenesisSHA256, OriginalGenesisHash: pins.OriginalGenesisHash, MigrationStateHash: pins.MigrationStateHash, OldStateVersion: 13, OldApplicationVersion: 19, CheckpointHeight: trace.LastHeight, CheckpointAppHash: trace.EngineAppHash, UpgradeHeight: trace.LastHeight + 1, NewStateVersion: 18, NewApplicationVersion: 20}
	wire, pin := runtimePlanBytes(t, plan)
	runtime, err := NewRuntimeUpgradeAuthorization(wire, pin, b, migration)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewRuntimeUpgradeAuthorization(wire, strings.Repeat("1", 64), b, migration); err == nil {
		t.Fatal("wrong runtime pin accepted")
	}
	if _, err := p.FileSource(path, auth, runtime); err != nil {
		t.Fatal("independently pinned runtime binding refused", err)
	}
	for _, wrong := range []*RuntimeUpgradeAuthorization{{}, runtime} {
		_, e1 := NewPQEngineFileSourceWithRuntimeUpgrade(migration, path, view, auth, wrong)
		_, e2 := prepared.FileSource(path, auth, wrong)
		if e1 == nil || e2 == nil || e1.Error() != e2.Error() {
			t.Fatal("runtime source mismatch/first cause changed", e1, e2)
		}
	}
}
