package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

type runtimeUpgradeFixture struct {
	migration     chain.ConsensusMigrationState
	bootstrap     *ConsensusBootstrap
	plan          RuntimeUpgradePlan
	authorization *RuntimeUpgradeAuthorization
	old           []CommittedState
	next          CommittedState
}

func runtimePlanBytes(t *testing.T, plan RuntimeUpgradePlan) ([]byte, string) {
	t.Helper()
	wire, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(wire)
	return wire, hex.EncodeToString(digest[:])
}

func runtimeTrustedCheckpoint(plan RuntimeUpgradePlan, state CommittedState) runtimeUpgradeCheckpoint {
	version := plan.OldApplicationVersion
	if state.Height >= plan.UpgradeHeight {
		version = plan.NewApplicationVersion
	}
	return runtimeUpgradeCheckpoint{chainID: plan.ChainID, cometGenesisSHA256: plan.CometGenesisSHA256, height: state.Height, appHash: state.AppHash, appVersion: version}
}

func newRuntimeUpgradeFixture(t *testing.T, version int) runtimeUpgradeFixture {
	t.Helper()
	migration, _ := journalFixture(t) // Actual complete source, including QA funds.
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 51)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	var err error
	migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCometGenesis(migration, time.Unix(1802736000, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	oldAppVersion := uint64(18)
	if version == 13 {
		oldAppVersion = 19
	}
	doc.ConsensusParams.Version.App = oldAppVersion
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	genesisHash := sha256.Sum256(raw)
	bootstrap, err := NewConsensusBootstrap(raw, ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(genesisHash[:]), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash}, migration)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	old := app.committed
	old.Version = version
	var historical CommittedState
	if err := json.Unmarshal(historicalPerformanceStateJSON(t, old), &historical); err != nil {
		t.Fatal(err)
	}
	app.committed, app.replayStateVersion = historical, version
	f := runtimeUpgradeFixture{migration: migration, bootstrap: bootstrap}
	for nonce := uint64(1); nonce <= 3; nonce++ {
		commitJournalBlock(t, app, nonce)
		f.old = append(f.old, app.committed)
	}
	// A real new-runtime block is separate from old replay; no source anchor is
	// replaced or old transaction receipt/history manufactured by this fixture.
	f.plan = RuntimeUpgradePlan{Format: RuntimeUpgradePlanFormat, ChainID: doc.ChainID, NativeChainID: migration.Network.ChainID, CometGenesisSHA256: hex.EncodeToString(genesisHash[:]), OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: migration.StateHash, OldStateVersion: version, OldApplicationVersion: oldAppVersion, CheckpointHeight: app.committed.Height, CheckpointAppHash: app.committed.AppHash, UpgradeHeight: app.committed.Height + 1, NewStateVersion: 18, NewApplicationVersion: 20}
	wire, pin := runtimePlanBytes(t, f.plan)
	f.authorization, err = NewRuntimeUpgradeAuthorization(wire, pin, bootstrap, migration)
	if err != nil {
		t.Fatal(err)
	}
	app.replayStateVersion = 0
	commitJournalBlock(t, app, 4)
	f.next = app.committed
	return f
}

func TestRuntimeUpgradeCanonicalPlanAndIndependentAnchors(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	for _, profile := range []struct {
		schema int
		app    uint64
		valid  bool
	}{{12, 18, true}, {13, 19, true}, {12, 19, false}, {13, 18, false}, {11, 17, false}, {14, 20, false}} {
		candidate := f.plan
		candidate.OldStateVersion, candidate.OldApplicationVersion = profile.schema, profile.app
		if err := candidate.Validate(); (err == nil) != profile.valid {
			t.Fatal("old source identity pair was guessed or changed", profile, err)
		}
	}
	wire, pin := runtimePlanBytes(t, f.plan)
	if got, err := f.plan.Hash(); err != nil || got != pin {
		t.Fatal("canonical plan hash changed", err)
	}
	if _, err := NewRuntimeUpgradeAuthorization(wire, strings.Repeat("a", 64), f.bootstrap, f.migration); err == nil {
		t.Fatal("self-reported plan bypassed independent pin")
	}
	for _, mutate := range []func(RuntimeUpgradePlan) RuntimeUpgradePlan{
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.Format += "-unknown"; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.ChainID = "ynx_1-1"; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.NativeChainID++; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan {
			p.CometGenesisSHA256 = strings.Repeat("a", 64)
			return p
		},
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan {
			p.OriginalGenesisHash = strings.Repeat("b", 64)
			return p
		},
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan {
			p.MigrationStateHash = strings.Repeat("c", 64)
			return p
		},
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.OldStateVersion = 11; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.OldApplicationVersion = 18; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.UpgradeHeight++; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.CheckpointHeight = -1; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.CheckpointAppHash = strings.Repeat("0", 64); return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.NewStateVersion = 19; return p },
		func(p RuntimeUpgradePlan) RuntimeUpgradePlan { p.NewApplicationVersion = 21; return p },
	} {
		bad, badPin := runtimePlanBytes(t, mutate(f.plan))
		if _, err := NewRuntimeUpgradeAuthorization(bad, badPin, f.bootstrap, f.migration); err == nil {
			t.Fatal("unknown/mismatched runtime profile acquired authority", string(bad))
		}
	}
	for _, malformed := range [][]byte{
		append(bytes.Clone(wire), '\n'),
		append(bytes.Clone(wire), []byte("{}")...),
		bytes.Replace(wire, []byte(`"oldStateVersion":13`), []byte(`"oldStateVersion":13,"oldStateVersion":13`), 1),
		bytes.Replace(wire, []byte(`"oldStateVersion":13`), []byte(`"unexpected":0,"oldStateVersion":13`), 1),
		bytes.Replace(wire, []byte(`"nativeChainId":"6423"`), []byte(`"nativeChainId":6423`), 1),
		bytes.Repeat([]byte{' '}, MaxRuntimeUpgradePlanBytes+1),
	} {
		digest := sha256.Sum256(malformed)
		if _, err := NewRuntimeUpgradeAuthorization(malformed, hex.EncodeToString(digest[:]), f.bootstrap, f.migration); err == nil {
			t.Fatal("noncanonical plan accepted")
		}
	}
	if _, err := NewRuntimeUpgradeAuthorization(wire, pin, nil, f.migration); err == nil {
		t.Fatal("missing independent bootstrap accepted")
	}
	copy, err := f.authorization.Plan()
	if err != nil {
		t.Fatal(err)
	}
	copy.UpgradeHeight++
	again, err := f.authorization.Plan()
	if err != nil || again != f.plan {
		t.Fatal("returned plan mutated installed authorization", err)
	}
}

func TestRuntimeUpgradePreservesOldHeightsAndRequiresConfirmedBoundary(t *testing.T) {
	for _, version := range []int{12, 13} {
		f := newRuntimeUpgradeFixture(t, version)
		cursor, err := newRuntimeUpgradeCursor(f.authorization, f.migration, f.old[0], runtimeTrustedCheckpoint(f.plan, f.old[0]))
		if err != nil {
			t.Fatal(err)
		}
		if err := cursor.confirmCommitted(f.migration, f.old[2], runtimeTrustedCheckpoint(f.plan, f.old[2])); err == nil {
			t.Fatal("skipped trusted replay height accepted")
		}
		for i := 0; i < 2; i++ {
			mode, err := cursor.modeForNext(f.old[i], f.old[i].Height+1)
			if err != nil || mode.hashVersion != version || mode.appVersion != f.plan.OldApplicationVersion {
				t.Fatal("old replay changed state/AppVersion domain", err)
			}
			retry, err := cursor.modeForNext(f.old[i], f.old[i].Height+1)
			if err != nil || retry != mode {
				t.Fatal("uncommitted attempt advanced runtime mode", err)
			}
			if _, err := cursor.modeForNext(f.old[i+1], f.old[i+1].Height+1); err == nil {
				t.Fatal("pending state advanced cursor without actual checkpoint")
			}
			if err := cursor.confirmCommitted(f.migration, f.old[i+1], runtimeTrustedCheckpoint(f.plan, f.old[i+1])); err != nil {
				t.Fatal(err)
			}
			if err := cursor.confirmCommitted(f.migration, f.old[i], runtimeTrustedCheckpoint(f.plan, f.old[i])); err == nil {
				t.Fatal("observed checkpoint regressed")
			}
		}
		boundary := f.old[2]
		mode, err := cursor.modeForNext(boundary, f.plan.UpgradeHeight)
		if err != nil || mode.hashVersion != 0 || mode.appVersion != 20 {
			t.Fatal("exact authorized boundary did not select new runtime", err)
		}
		if _, err := cursor.modeForNext(boundary, f.plan.UpgradeHeight+1); err == nil {
			t.Fatal("execution skipped upgrade height")
		}
		wrong := runtimeTrustedCheckpoint(f.plan, f.next)
		wrong.appHash = strings.Repeat("d", 64)
		if err := cursor.confirmCommitted(f.migration, f.next, wrong); err == nil {
			t.Fatal("UNKNOWN or incorrect checkpoint confirmed new state")
		}
		if retry, err := cursor.modeForNext(boundary, f.plan.UpgradeHeight); err != nil || retry != mode {
			t.Fatal("failed confirmation erased original boundary", err)
		}
		if err := cursor.confirmCommitted(f.migration, f.next, runtimeTrustedCheckpoint(f.plan, f.next)); err != nil {
			t.Fatal(err)
		}
		if err := cursor.confirmCommitted(f.migration, f.next, runtimeTrustedCheckpoint(f.plan, f.next)); err != nil {
			t.Fatal("exact committed retry refused", err)
		}
		if err := cursor.confirmCommitted(f.migration, boundary, runtimeTrustedCheckpoint(f.plan, boundary)); err == nil {
			t.Fatal("post-upgrade rollback accepted")
		}
		cold, err := newRuntimeUpgradeCursor(f.authorization, f.migration, f.next, runtimeTrustedCheckpoint(f.plan, f.next))
		if err != nil {
			t.Fatal(err)
		}
		if mode, err := cold.modeForNext(f.next, f.next.Height+1); err != nil || mode.hashVersion != 0 || mode.appVersion != 20 {
			t.Fatal("cold trusted resume reverted runtime", err)
		}
		for _, mutate := range []func(*runtimeUpgradeCheckpoint){
			func(c *runtimeUpgradeCheckpoint) { c.height++ },
			func(c *runtimeUpgradeCheckpoint) { c.appHash = strings.Repeat("e", 64) },
			func(c *runtimeUpgradeCheckpoint) { c.appVersion = 19 },
			func(c *runtimeUpgradeCheckpoint) { c.chainID = "ynx_1-1" },
			func(c *runtimeUpgradeCheckpoint) { c.cometGenesisSHA256 = strings.Repeat("f", 64) },
		} {
			bad := runtimeTrustedCheckpoint(f.plan, f.next)
			mutate(&bad)
			if _, err := newRuntimeUpgradeCursor(f.authorization, f.migration, f.next, bad); err == nil {
				t.Fatal("cold resume accepted wrong engine anchor")
			}
		}
		badPlan := f.plan
		badPlan.CheckpointAppHash = strings.Repeat("a", 64)
		wire, pin := runtimePlanBytes(t, badPlan)
		badAuth, err := NewRuntimeUpgradeAuthorization(wire, pin, f.bootstrap, f.migration)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := newRuntimeUpgradeCursor(badAuth, f.migration, boundary, runtimeTrustedCheckpoint(badPlan, boundary)); err == nil {
			t.Fatal("independent upgrade checkpoint was not enforced")
		}
	}
}

func TestRuntimeUpgradeSourceSupplementDoesNotGrantV1Execution(t *testing.T) {
	f := newRuntimeUpgradeFixture(t, 13)
	original := legacyMigrationForTest(t, f.migration)
	pins := RuntimeSourceSupplementPins{OriginalMigrationStateHash: original.StateHash, SupplementMigrationStateHash: f.migration.StateHash, OriginalGenesisHash: f.migration.OriginalGenesisHash}
	originalWire, _ := json.Marshal(original)
	supplementWire, _ := json.Marshal(f.migration)
	if err := VerifyRuntimeSourceSupplement(original, f.migration, pins); err != nil {
		t.Fatal("matching independently pinned original source projection refused", err)
	}
	if _, err := NewApplication(original); err == nil || !strings.Contains(err.Error(), "source_runtime") {
		t.Fatal("static source comparison bypassed execution closure", err)
	}
	p := f.plan
	p.MigrationStateHash = original.StateHash
	wire, pin := runtimePlanBytes(t, p)
	if _, err := NewRuntimeUpgradeAuthorization(wire, pin, f.bootstrap, original); err == nil || !strings.Contains(err.Error(), "source_runtime") {
		t.Fatal("runtime plan fabricated V1 execution authority", err)
	}
	for _, change := range []func(*chain.ConsensusMigrationState){
		func(m *chain.ConsensusMigrationState) { m.Accounts[0].Nonce++ },
		func(m *chain.ConsensusMigrationState) { m.LastBlockHash = strings.Repeat("a", 64) },
	} {
		var changed chain.ConsensusMigrationState
		if err := json.Unmarshal(originalWire, &changed); err != nil {
			t.Fatal(err)
		}
		change(&changed)
		changed.StateHash = ""
		raw, err := json.Marshal(changed)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(raw)
		changed.StateHash = hex.EncodeToString(digest[:])
		if err := changed.Validate(); err != nil {
			t.Fatal("counterexample requires valid independent old anchor", err)
		}
		badPins := pins
		badPins.OriginalMigrationStateHash = changed.StateHash
		if err := VerifyRuntimeSourceSupplement(changed, f.migration, badPins); err == nil {
			t.Fatal("independently resealed different nonce/history accepted as original source")
		}
	}
	badPins := pins
	badPins.SupplementMigrationStateHash = strings.Repeat("b", 64)
	if err := VerifyRuntimeSourceSupplement(original, f.migration, badPins); err == nil {
		t.Fatal("wrong supplemental independent pin accepted")
	}
	badPins = pins
	badPins.OriginalGenesisHash = strings.Repeat("c", 64)
	if err := VerifyRuntimeSourceSupplement(original, f.migration, badPins); err == nil {
		t.Fatal("wrong native genesis pin accepted")
	}
	afterOriginal, _ := json.Marshal(original)
	afterSupplement, _ := json.Marshal(f.migration)
	if !bytes.Equal(originalWire, afterOriginal) || !bytes.Equal(supplementWire, afterSupplement) {
		t.Fatal("source comparison rewrote original anchors or history")
	}
	// No constructor opened/wrote either state file, changed the bootstrap,
	// initialized a signer, or weakened migration closure during these checks.
}

func TestRuntimeUpgradeAllowsValidatedRegistryAndScheduleProgression(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	// QA creates its own old-profile genesis; this is not evidence that a
	// deployed genesis/checkpoint has been recovered or independently verified.
	f.doc.ConsensusParams.Version.App = 19
	var err error
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(f.raw)
	f.pins.CometGenesisSHA256 = hex.EncodeToString(sum[:])
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	app := newPinnedRegistryApp(t, f, "")
	old := app.committed
	old.Version = 13
	var projected CommittedState
	if err := json.Unmarshal(historicalPerformanceStateJSON(t, old), &projected); err != nil {
		t.Fatal(err)
	}
	projected.bootstrap = f.bootstrap
	app.committed, app.replayStateVersion = projected, 13
	ctx := context.Background()
	if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	boundary := app.committed
	plan := RuntimeUpgradePlan{Format: RuntimeUpgradePlanFormat, ChainID: f.doc.ChainID, NativeChainID: f.migration.Network.ChainID, CometGenesisSHA256: f.pins.CometGenesisSHA256, OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash, OldStateVersion: 13, OldApplicationVersion: 19, CheckpointHeight: boundary.Height, CheckpointAppHash: boundary.AppHash, UpgradeHeight: boundary.Height + 1, NewStateVersion: 18, NewApplicationVersion: 20}
	wire, pin := runtimePlanBytes(t, plan)
	authorization, err := NewRuntimeUpgradeAuthorization(wire, pin, f.bootstrap, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	cursor, err := newRuntimeUpgradeCursor(authorization, f.migration, boundary, runtimeTrustedCheckpoint(plan, boundary))
	if err != nil {
		t.Fatal(err)
	}
	app.replayStateVersion = 0
	commitNext := func(txs [][]byte, wantSchema int) CommittedState {
		t.Helper()
		height := app.committed.Height + 1
		mode, err := cursor.modeForNext(app.committed, height)
		if err != nil || mode.hashVersion != 0 || mode.appVersion != 20 {
			t.Fatal("new schema progression changed execution domain", err)
		}
		response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: txs})
		if err != nil {
			t.Fatal(err)
		}
		for _, result := range response.TxResults {
			if result.Code != 0 {
				t.Fatal("actual independently authorized registry transaction failed", result.Log)
			}
		}
		if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		if app.committed.Version != wantSchema {
			t.Fatal("actual runtime emitted unexpected schema", app.committed.Version, wantSchema)
		}
		if err := cursor.confirmCommitted(f.migration, app.committed, runtimeTrustedCheckpoint(plan, app.committed)); err != nil {
			t.Fatal("runtime cursor blocked an actually validated schema transition", err)
		}
		return app.committed
	}
	base := commitNext(nil, 18)
	for _, version := range []int{14, 15, 16, 17, 19, 20, 21} {
		forged := base
		forged.Version, forged.Height = version, base.Height+1
		if err := cursor.confirmCommitted(f.migration, forged, runtimeTrustedCheckpoint(plan, forged)); err == nil {
			t.Fatal("schema label replaced complete state/registry/schedule validation", version)
		}
	}
	// Even unchanged checkpoint labels cannot make a body with a stale AppHash
	// valid. confirmCommitted must execute State.Validate before exact retry.
	forged := base
	forged.Accounts = append([]chain.ConsensusAccount(nil), base.Accounts...)
	forged.Accounts[0].Balance++
	if err := cursor.confirmCommitted(f.migration, forged, runtimeTrustedCheckpoint(plan, forged)); err == nil {
		t.Fatal("trusted labels accepted an invalid state body")
	}
	var registrations [][]byte
	for i := range f.bootstrap.record.Members {
		transaction, _ := f.transaction(t, i, base.Height+1)
		registrations = append(registrations, transaction)
	}
	registered := commitNext(registrations, 19)
	downgrade := base
	downgrade.Height = registered.Height + 1
	if err := downgrade.Validate(f.migration); err != nil {
		t.Fatal("schema rollback counterexample must otherwise be valid", err)
	}
	if err := cursor.confirmCommitted(f.migration, downgrade, runtimeTrustedCheckpoint(plan, downgrade)); err == nil {
		t.Fatal("observed registry schema regressed to a valid base state")
	}
	schedule, err := NewPQEngineSchedule(f.bootstrap, registered.ValidatorRegistry, registered.Height, registered.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	scheduleWire, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	schedulePin, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	engineAuthorization, err := NewPQEngineAuthorization(scheduleWire, schedulePin)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "registered.json")
	if err := saveCommittedState(path, registered, f.migration); err != nil {
		t.Fatal(err)
	}
	app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, engineAuthorization)
	if err != nil {
		t.Fatal(err)
	}
	scheduled := commitNext(nil, 20)
	downgrade = registered
	downgrade.Height = scheduled.Height + 1
	if err := downgrade.Validate(f.migration); err != nil {
		t.Fatal("schedule rollback counterexample must otherwise be valid", err)
	}
	if err := cursor.confirmCommitted(f.migration, downgrade, runtimeTrustedCheckpoint(plan, downgrade)); err == nil {
		t.Fatal("observed scheduled schema regressed to registry-only state")
	}
	for _, state := range []CommittedState{registered, scheduled} {
		cold, err := newRuntimeUpgradeCursor(authorization, f.migration, state, runtimeTrustedCheckpoint(plan, state))
		if err != nil {
			t.Fatal("cold exact trusted newer schema refused", err)
		}
		if mode, err := cold.modeForNext(state, state.Height+1); err != nil || mode.hashVersion != 0 {
			t.Fatal("cold newer schema was assigned a historical decoder version", err)
		}
	}
}
