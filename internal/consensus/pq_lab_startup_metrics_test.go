//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	cmttypes "github.com/cometbft/cometbft/types"
)

// Uses original BlockExecutor disk stores and real Ed/dual-PoP registrations.
// There is no Node.Start, synthetic observed height, or cached current state.
func TestPQLabStartupMeasuredRegistrationActivationPreserveFreshState(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	persistPQLabTestCheckpoint(t, p, pin, nil)
	original := inspectionInventory(t, p.Nodes[0].StatePath)
	var txs cmttypes.Txs
	for i := 0; i < 4; i++ {
		metrics := &PQLabMetrics{}
		before := validatedMigrationFullChecks.Load()
		reg, err := PreparePQLabValidatorRegistrationMeasured(p.RootDir, pin, i, p.InitialHeight+1, metrics)
		if err != nil {
			t.Fatal(err)
		}
		measured := metrics.Snapshot()
		if measured.Stages["registration.freshCheckpointFullValidation"].Calls != 8 || measured.Stages["lab.bootstrapFullValidation"].Calls != 1 || measured.Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || validatedMigrationFullChecks.Load()-before != 1 {
			t.Fatal("registration lost fresh reads or repeated static owner validation", measured)
		}
		if reg.BroadcastExecuted || !reg.SyntheticOnly || reg.TransactionHash != pqLabSHA(reg.Transaction) {
			t.Fatal("registration evidence changed")
		}
		raw, _ := json.Marshal(measured)
		t.Logf("registration node=%d actual_elapsed=%s", i, raw)
		txs = append(txs, reg.Transaction)
	}
	if !reflect.DeepEqual(original, inspectionInventory(t, p.Nodes[0].StatePath)) {
		t.Fatal("registration wrote application")
	}
	persistPQLabTestCheckpoint(t, p, pin, txs)
	original = inspectionInventory(t, p.Nodes[0].StatePath, filepath.Join(p.Nodes[0].Home, "data", "state.db"))
	_, m, b, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	genesis, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	opts := OperatorCheckpointOptions{StatePath: p.Nodes[0].StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(p.Nodes[0].Home, "data"), SigningStatePath: p.Nodes[0].LegacyStateFile}
	start := time.Now()
	expected, err := InspectOperatorCheckpoint(m, genesis, p.pins(), opts)
	if err != nil {
		t.Fatal(err)
	}
	publicNS := time.Since(start).Nanoseconds()
	in, entry, err := loadPQLabStartupInputs(p.RootDir, pin, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = in.close() })
	count := validatedMigrationFullChecks.Load()
	start = time.Now()
	actual, err := inspectOperatorCheckpointOwned(entry.witness, opts)
	ownedNS := time.Since(start).Nanoseconds()
	a, _ := json.Marshal(actual)
	e, _ := json.Marshal(expected)
	if err != nil || !bytes.Equal(a, e) || validatedMigrationFullChecks.Load() != count {
		t.Fatal("private stopped inspection differs from full public validation", err)
	}
	t.Logf("same original stopped checkpoint public_ns=%d owned_fresh_ns=%d (no network/performance qualification)", publicNS, ownedNS)
	metrics := &PQLabMetrics{}
	count = validatedMigrationFullChecks.Load()
	activation, err := ActivatePQLabNetworkMeasured(p.RootDir, pin, metrics)
	if err != nil {
		t.Fatal(err)
	}
	got := metrics.Snapshot()
	if got.Stages["activation.stoppedCheckpointFullInspection"].Calls != 12 || got.Stages["activation.originalCustodyPreparation"].Calls != 4 || got.Stages["lab.bootstrapFullValidation"].Calls != 1 || got.Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || validatedMigrationFullChecks.Load()-count != 1 {
		t.Fatal("activation lost stopped checks or rebuilt static ownership", got)
	}
	if activation.NodeStarted || activation.PQQuorumVerified || activation.RegistryHeight != expected.Height || activation.AppHash != expected.AppHash {
		t.Fatal("activation retargeted actual checkpoint")
	}
	if !reflect.DeepEqual(original, inspectionInventory(t, p.Nodes[0].StatePath, filepath.Join(p.Nodes[0].Home, "data", "state.db"))) {
		t.Fatal("activation changed source state or DB")
	}
	raw, _ := json.Marshal(got)
	t.Logf("activation actual_elapsed=%s", raw)
	schedule, err := os.ReadFile(activation.ScheduleFile)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(schedule, activation.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	// A new owner must fully revalidate, not borrow a previous invocation.
	for _, n := range p.Nodes {
		fresh, err := readPQEngineCommittedState(n.StatePath, m, b, auth, nil)
		if err != nil {
			t.Fatal("normal cold source", err)
		}
		if fresh.Height != activation.RegistryHeight || fresh.AppHash != activation.AppHash {
			t.Fatal("cold checkpoint changed")
		}
	}
	before := inspectionInventory(t, p.RootDir)
	if _, err = ActivatePQLabNetworkMeasured(p.RootDir, pin, &PQLabMetrics{}); err == nil {
		t.Fatal("UNKNOWN activation retried")
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, p.RootDir)) {
		t.Fatal("reentry changed custody/result")
	}
	// Retaining static mathematics cannot hide changed current state.
	saved, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(p.Nodes[0].StatePath, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = pqLabRegistrationCheckpointOwned(p, entry.witness, expected.Height+1, nil); err == nil {
		t.Fatal("cached static owner hid changed state")
	}
	if err = os.WriteFile(p.Nodes[0].StatePath, saved, 0600); err != nil {
		t.Fatal(err)
	}
	if err = in.close(); err != nil {
		t.Fatal(err)
	}
	if in.current() == nil {
		t.Fatal("closed invocation remains current")
	}
}

func TestPQLabStartupHeldInputsRejectReplacementAndWrongPin(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	before := inspectionInventory(t, p.RootDir)
	if in, _, err := loadPQLabStartupInputs(p.RootDir, p.IdentitySHA256, nil); err == nil || in != nil {
		t.Fatal("independent plan pin ignored")
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, p.RootDir)) {
		t.Fatal("failed preflight changed originals")
	}
	in, _, err := loadPQLabStartupInputs(p.RootDir, pin, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = in.close() })
	raw, err := os.ReadFile(p.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	// Exact same bytes and pathname with a new inode are still a changed source.
	replacement := p.MigrationFile + ".replacement"
	if err = os.WriteFile(replacement, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(replacement, p.MigrationFile); err != nil {
		t.Fatal(err)
	}
	if in.current() == nil {
		t.Fatal("held witness accepted replaced original file")
	}
	if err = in.close(); err != nil {
		t.Fatal(err)
	}
	if in.current() == nil {
		t.Fatal("closed failed input owner recovered eligibility")
	}
}
