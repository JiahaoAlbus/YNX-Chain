//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	cmttypes "github.com/cometbft/cometbft/types"
)

// Same legal two-owner/33 MiB original as the bounded-cache regression. This
// is a single CLI input lifetime, not a process-global larger cache or a cache
// of current checkpoints/permissions. It starts no node or publisher.
func pqLabHeldWitnessOriginal(t *testing.T) (PQLabNetworkPlan, PQLabLiveMaterialsPolicy, []byte) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 2, BatchSize: 1, Owners: 2, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	root := filepath.Join(pqLabWorkloadTemp(t), "lab")
	plan, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	planRaw, err := os.ReadFile(filepath.Join(root, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := os.ReadFile(plan.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	large := append(bytes.Repeat([]byte(" "), 33<<20), migrationRaw...)
	if err := os.WriteFile(plan.MigrationFile, large, 0600); err != nil {
		t.Fatal(err)
	}
	policy := PQLabLiveMaterialsPolicy{RootDir: root, PlanSHA256: pqLabSHA(planRaw)}
	return plan, policy, large
}

func TestPQLabLiveMaterialsInvocationWitnessReusesHeldValidation(t *testing.T) {
	plan, policy, large := pqLabHeldWitnessOriginal(t)
	root := policy.RootDir
	metrics := &PQLabMetrics{}
	in := &pqLabLiveMaterialsInputs{policy: policy, directory: root, cache: NewPQLabStaticCache(), metrics: metrics}
	t.Cleanup(func() { _ = in.close() })
	start := time.Now()
	first, err := in.loadStatic()
	firstElapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	before := validatedMigrationFullChecks.Load()
	firstMetrics := metrics.Snapshot()
	if in.uncached == nil || len(in.uncached.originals) != 12 || in.cache.Stats().Entries != 0 || in.cache.Stats().OriginalBytes != 0 || in.cache.Stats().Bypasses != 1 {
		t.Fatal("large held originals entered the optional global cache", in.cache.Stats())
	}
	start = time.Now()
	if err := in.current(); err != nil {
		t.Fatal(err)
	}
	second, err := in.loadStatic()
	reuseElapsed := time.Since(start)
	after := metrics.Snapshot()
	cost, _ := json.Marshal(struct {
		FirstNS, CurrentPlusReloadNS int64
		First, After                 PQLabMetricsSnapshot
	}{firstElapsed.Nanoseconds(), reuseElapsed.Nanoseconds(), firstMetrics, after})
	t.Logf("held original invocation measured cost: %s", cost)
	if err != nil || second.witness != first.witness || validatedMigrationFullChecks.Load() != before || after.Stages["lab.bootstrapFullValidation"].Calls != firstMetrics.Stages["lab.bootstrapFullValidation"].Calls || after.Stages["lab.validatedMigrationOwnerBuild"].Calls != firstMetrics.Stages["lab.validatedMigrationOwnerBuild"].Calls {
		t.Fatal("same invocation rebuilt fully validated original witness after current FD/hash checks", err)
	}
	if after.Stages["live.heldStaticWitnessCurrent"].Calls != 2 || in.cache.Stats().Entries != 0 || in.cache.Stats().Bypasses != 1 {
		t.Fatal("per-use original checks disappeared or optional cache boundary changed")
	}
	for _, changed := range []PQLabLiveMaterialsPolicy{
		{RootDir: root, PlanSHA256: strings.Repeat("0", 64)},
		{RootDir: filepath.Dir(root), PlanSHA256: policy.PlanSHA256},
	} {
		foreign := *in
		foreign.policy = changed
		if got, err := foreign.loadStatic(); err == nil || got != nil {
			t.Fatal("held invocation witness was rebound to another root or independent pin", err)
		}
	}
	// A separate inputs owner must still perform its own full original
	// validation and may never borrow a witness from this invocation.
	independent := &pqLabLiveMaterialsInputs{policy: policy, directory: root, cache: NewPQLabStaticCache()}
	other, err := independent.loadStatic()
	if err != nil || other.witness == first.witness || validatedMigrationFullChecks.Load() <= before {
		t.Fatal("independent invocation reused prior source eligibility", err)
	}
	if err := independent.close(); err != nil {
		t.Fatal(err)
	}
	if other.current() == nil {
		t.Fatal("closed independent inputs retained source eligibility")
	}
	if err := in.current(); err != nil {
		t.Fatal("closing another owner invalidated original held inputs", err)
	}
	if err := in.close(); err != nil {
		t.Fatal(err)
	}
	if first.current() == nil || in.current() == nil {
		t.Fatal("closed invocation reused validated original inputs")
	}
	afterBytes, err := os.ReadFile(plan.MigrationFile)
	if err != nil || !bytes.Equal(large, afterBytes) {
		t.Fatal("witness reuse rewrote original raw migration", err)
	}
}

func TestPQLabLiveMaterialsInvocationWitnessNormalSetupAndColdScope(t *testing.T) {
	plan, policy, large := pqLabHeldWitnessOriginal(t)
	root, pin := policy.RootDir, policy.PlanSHA256
	persistPQLabTestCheckpoint(t, plan, pin, nil)
	var registrations cmttypes.Txs
	for i := 0; i < 4; i++ {
		registered, err := PreparePQLabValidatorRegistration(root, pin, i, plan.InitialHeight+1)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, registered.Transaction)
	}
	persistPQLabTestCheckpoint(t, plan, pin, registrations)
	if _, err := ActivatePQLabNetwork(root, pin); err != nil {
		t.Fatal(err)
	}
	activationRaw, err := os.ReadFile(filepath.Join(root, "activation", "activation.json"))
	if err != nil {
		t.Fatal(err)
	}
	policy.Version, policy.ActivationSHA256 = PQLabLiveMaterialsPolicyVersion, pqLabSHA(activationRaw)
	policy.MaxOperations, policy.CaptureTimeout = 1, 30*time.Second
	policy.TrustingPeriod, policy.MaxClockDrift = time.Hour, time.Minute
	policy.TrustNumerator, policy.TrustDenominator = 1, 3
	metrics := &PQLabMetrics{}
	setup, err := PreparePQLabLiveMaterialsMeasured(policy, metrics)
	if err != nil {
		t.Fatal("normal held-source setup", err)
	}
	snapshot := metrics.Snapshot()
	rawMetrics, _ := json.Marshal(snapshot)
	t.Logf("normal complete setup measured cost: %s", rawMetrics)
	// The original separate pre-mutation preflight still validates once. The
	// held owner validates once more, then only rechecks its exact originals.
	if snapshot.Stages["lab.bootstrapFullValidation"].Calls != 2 || snapshot.Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || snapshot.Stages["live.heldStaticWitnessCurrent"].Calls < 4 {
		t.Fatal("normal setup rebuilt held static mathematics or omitted full preflight", snapshot)
	}
	for _, stage := range []string{"live.anchorStateFullValidation", "live.anchorRegistryFullReplay", "live.anchorCommitFullVerification"} {
		if snapshot.Stages[stage].Calls != 4 {
			t.Fatal("normal setup skipped a complete original R checkpoint/registry/commit", stage, snapshot)
		}
	}
	coldMetrics := &PQLabMetrics{}
	cold, err := loadPQLabLiveMaterialsPolicyMeasured(setup.Policy.Path, setup.Policy.SHA256, coldMetrics)
	if err != nil {
		t.Fatal("new input lifetime cold policy", err)
	}
	t.Cleanup(func() { _ = cold.close() })
	if coldMetrics.Snapshot().Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || coldMetrics.Snapshot().Stages["lab.bootstrapFullValidation"].Calls != 1 || cold.cache.Stats().Entries != 0 {
		t.Fatal("cold invocation skipped independent original validation or enlarged optional cache")
	}
	if err := cold.current(); err != nil {
		t.Fatal(err)
	}
	// Same bytes and restored mtime are still a new change epoch. The retained
	// witness cannot turn a current-file refusal into a cache hit or rebase.
	info, err := os.Stat(plan.MigrationFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(plan.MigrationFile, large, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(plan.MigrationFile, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	beforeChecks := validatedMigrationFullChecks.Load()
	if cold.current() == nil {
		t.Fatal("same-byte source rewrite bypassed original ctime/FD current validation")
	}
	if got, err := cold.loadStatic(); err == nil || got != nil || validatedMigrationFullChecks.Load() != beforeChecks {
		t.Fatal("changed held original was silently rebound/revalidated into eligibility", err)
	}
}
