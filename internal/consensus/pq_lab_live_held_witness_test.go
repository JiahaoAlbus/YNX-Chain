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

func TestPQLabLiveMaterialsHeldVerifierMatchesColdProof(t *testing.T) {
	m, proof := pqLabProofFixture(t)
	root := pqLabWorkloadTemp(t)
	original := filepath.Join(root, "migration.json")
	proofSourceWrite(t, original, m.Migration)
	source, err := readProofHostOriginal(original, proofHostSHA(m.Migration), maxProofHostMigrationBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer source.file.Close()
	migration, err := decodeProofHostMigration(source.raw)
	if err != nil {
		t.Fatal(err)
	}
	witness, err := newPQLabLiveBootstrap(m.Genesis, m.Pins, migration, nil)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	in := &proofHostInputs{
		plan: ProofHostSourcePlan{ConsensusGenesisSHA256: m.Pins.CometGenesisSHA256, OriginalGenesisHash: m.Pins.OriginalGenesisHash,
			MigrationStateHash: m.Pins.MigrationStateHash, ScheduleHash: m.ScheduleHash},
		bootstrap: witness.bootstrap, engine: engine,
		originals:     map[string]*proofHostOriginal{"genesis": {raw: m.Genesis}, "schedule": {raw: m.Schedule}},
		heldMigration: &pqLabProofMigration{witness: witness, original: source, canonical: source.raw},
	}
	now := time.Now().UTC()
	output := filepath.Join(root, "verifier")
	cold, err := WritePQLabProofInputs(output, m, proof, now)
	if err != nil {
		t.Fatal(err)
	}
	saved := filepath.Join(root, "cold")
	if err := os.Rename(output, saved); err != nil {
		t.Fatal(err)
	}
	held, err := in.writeLiveProofVerifier(output, m, proof, now)
	compareCold, _ := json.Marshal(cold)
	compareHeld, _ := json.Marshal(held)
	if err != nil || !bytes.Equal(compareCold, compareHeld) || !held.Result.Finalized {
		t.Fatal("held verifier diverged from independent cold verification", err)
	}
	for _, name := range []string{"migration.json", "committed-state.json", "trust-context.json", "request.json", "PUBLIC-PROOF-INPUTS.json"} {
		a, err := os.ReadFile(filepath.Join(saved, name))
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(filepath.Join(output, name))
		if err != nil || !bytes.Equal(a, b) {
			t.Fatal("held verifier changed a public original", name, err)
		}
	}
	changed := m
	changed.EngineAppHash = bytes.Repeat([]byte{0xff}, 32)
	if result, err := in.writeLiveProofVerifier(filepath.Join(root, "wrong-checkpoint"), changed, proof, now); err == nil || result.Result.Finalized {
		t.Fatal("held verifier accepted a changed committed checkpoint")
	}
}

func TestPQLabLiveMaterialsProofFrameMatchesOriginalEncoding(t *testing.T) {
	for _, size := range []int{1, 2, 3, 64<<10 + 2} {
		m := PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: bytes.Repeat([]byte{42}, size),
			Genesis: []byte("genesis"), CommittedState: []byte("state"), Schedule: []byte("schedule")}
		head, tail, err := pqLabProofMaterialFrame(m)
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "materials.json")
		receipt, err := writePQLabProofMaterialFrame(path, head, m.Migration, tail)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		expected, err := json.Marshal(m)
		if err != nil || !bytes.Equal(raw, expected) || receipt != pqLabFile(path, expected) {
			t.Fatal("streamed proof frame differs from original v1 JSON or receipt", size, err)
		}
		if _, err := writePQLabProofMaterialFrame(path, head, m.Migration, tail); err == nil {
			t.Fatal("existing frame was replaced")
		}
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
	// Pre-mutation preflight fully validates once and retains its original
	// owner for this invocation; every later use rechecks the held files.
	if snapshot.Stages["lab.bootstrapFullValidation"].Calls != 1 || snapshot.Stages["lab.validatedMigrationOwnerBuild"].Calls != 1 || snapshot.Stages["live.heldStaticWitnessCurrent"].Calls < 4 {
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
	original, err := cold.loadStatic()
	if err != nil {
		t.Fatal(err)
	}
	proofMigration, err := cold.proofMigrationFor(original)
	if err != nil {
		t.Fatal(err)
	}
	wantCanonical := bytes.TrimSpace(large)
	if proofMigration.rawSHA != pqLabSHA(large) || !bytes.Equal(proofMigration.canonical, wantCanonical) {
		t.Fatal("held proof canonicalization changed the raw digest or canonical verifier input")
	}
	again, err := cold.proofMigrationFor(original)
	if err != nil || again != proofMigration {
		t.Fatal("same live owner reconstructed the proof migration", err)
	}
	planForProof := ProofHostSourcePlan{MigrationFile: plan.MigrationFile, MigrationSHA256: proofMigration.rawSHA,
		GenesisFile: plan.GenesisFile, ConsensusGenesisSHA256: plan.CometGenesisSHA256,
		OriginalGenesisHash: plan.OriginalGenesisHash, MigrationStateHash: plan.MigrationStateHash,
		ScheduleFile: cold.activation.ScheduleFile, ScheduleSHA256: pqLabSHA(cold.schedule), ScheduleHash: cold.activation.ScheduleHash}
	owned, err := loadProofHostInputsWithMigration(planForProof, plan.ChainID, proofMigration)
	if err != nil || owned.originals["migration"] != proofMigration.original || owned.bootstrap != original.witness.bootstrap {
		t.Fatal("derived plan did not use its exact original migration and immutable bootstrap", err)
	}
	if err := owned.close(); err != nil {
		t.Fatal(err)
	}
	if _, err := loadProofHostInputsWithMigration(planForProof, "different-chain", proofMigration); err == nil {
		t.Fatal("held proof migration was rebound to a different chain")
	}
	changedPin := planForProof
	changedPin.MigrationSHA256 = strings.Repeat("a", 64)
	if _, err := loadProofHostInputsWithMigration(changedPin, plan.ChainID, proofMigration); err == nil {
		t.Fatal("held proof migration accepted a different raw source digest")
	}
	if err := cold.current(); err != nil {
		t.Fatal("closing borrowed proof input must leave the original owner current", err)
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
