package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

func registryMathCacheCommittedFixture(t *testing.T) (*validatorRegistryFixture, *Application, string) {
	t.Helper()
	f := newValidatorRegistryFixture(t)
	path := filepath.Join(t.TempDir(), "state.json")
	app := newPinnedRegistryApp(t, f, path)
	first, _ := f.transaction(t, 0, f.doc.InitialHeight)
	second, _ := f.transaction(t, 1, f.doc.InitialHeight)
	response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
		NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Height: f.doc.InitialHeight,
		Txs: [][]byte{first, second},
	})
	if err != nil || response == nil || len(response.TxResults) != 2 ||
		response.TxResults[0] == nil || response.TxResults[1] == nil ||
		response.TxResults[0].Code != 0 || response.TxResults[1].Code != 0 {
		t.Fatal("real registry fixture FinalizeBlock failed:", err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal("real registry fixture Commit failed:", err)
	}
	if app.pending != nil || app.committed.ValidatorRegistry == nil || len(app.committed.ValidatorRegistry.Events) != 2 {
		t.Fatal("fixture has no complete committed two-validator history")
	}
	return f, app, path
}

func registryMathCacheForApp(t *testing.T, app *Application) *ynxconsensusauth.RegistrationMathCache {
	t.Helper()
	if app.validatedMigration == nil || app.validatedMigration.registryMath == nil {
		t.Fatal("normal owned constructor did not install its private registry math cache")
	}
	cache := app.validatedMigration.registryMath
	if cache.Stats().Capacity != 16 {
		t.Fatal("registry mathematics cache changed its fixed capacity")
	}
	return cache
}

func registryMathStateWire(t *testing.T, state CommittedState) []byte {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func registryMathRewriteEvent(t *testing.T, event *ValidatorRegistryEvent, wire []byte) {
	t.Helper()
	payload, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	op, err := ynxconsensusauth.RegistrationHash(wire)
	if err != nil {
		t.Fatal(err)
	}
	event.Wire = bytes.Clone(wire)
	event.OperationHash = "0x" + hex.EncodeToString(op[:])
	event.ABCIHash = SignedTransactionHash(payload)
}

func TestValidatorRegistryMathCacheOwnedHitsPreserveOriginalStateAndHash(t *testing.T) {
	f, app, path := registryMathCacheCommittedFixture(t)
	cache := registryMathCacheForApp(t, app)
	cache.Clear()
	start := cache.Stats()
	if start.Entries != 0 || start.RetainedKeyBytes != 0 {
		t.Fatal("Clear retained registry mathematical keys")
	}
	original := registryMathStateWire(t, app.committed)
	disk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	appHash := app.committed.AppHash
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal("first complete owned state validation failed:", err)
	}
	first := cache.Stats()
	if first.Misses != start.Misses+2 || first.Hits != start.Hits || first.Entries != 2 || first.RetainedKeyBytes <= 0 {
		t.Fatalf("first replay did not perform both original registration math groups: start=%+v first=%+v", start, first)
	}
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal("second complete owned state validation failed:", err)
	}
	second := cache.Stats()
	if second.Hits != first.Hits+2 || second.Misses != first.Misses || second.Entries != first.Entries || second.RetainedKeyBytes != first.RetainedKeyBytes {
		t.Fatalf("same owned replay repeated registration math or changed its retained keys: first=%+v second=%+v", first, second)
	}
	// The original public replay wrapper explicitly uses no cache. Recheck its
	// real signatures and compare the exact resulting anchored history root.
	history, err := replayValidatorRegistry(app.committed.ValidatorRegistry, app.bootstrap, app.committed.Height)
	if err != nil {
		t.Fatal("uncached original registry replay failed:", err)
	}
	root := history.Root()
	if hex.EncodeToString(root[:]) != app.committed.ValidatorRegistry.Root {
		t.Fatal("owned cache changed the original uncached registry root")
	}
	// Complete public Validate creates its own original validation boundary;
	// it cannot inherit this App's warmed private witness or statistics.
	var decoded CommittedState
	if err := json.Unmarshal(original, &decoded); err != nil {
		t.Fatal(err)
	}
	decoded.bootstrap = f.bootstrap
	if err := decoded.Validate(f.migration); err != nil {
		t.Fatal("complete original public Validate failed:", err)
	}
	if cache.Stats() != second {
		t.Fatal("independent public validation borrowed the owning App's cache")
	}
	hash, err := app.committed.calculateHash()
	if err != nil || hash != appHash || decoded.AppHash != appHash || !bytes.Equal(original, registryMathStateWire(t, decoded)) ||
		!bytes.Equal(original, registryMathStateWire(t, app.committed)) {
		t.Fatal("mathematical cache changed complete committed serialization or AppHash:", err)
	}
	currentDisk, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(disk, currentDisk) {
		t.Fatal("read-only validation changed the original committed file:", err)
	}
}

func TestValidatorRegistryMathCacheWarmHitsNeverAuthorizeChangedRegistry(t *testing.T) {
	_, app, _ := registryMathCacheCommittedFixture(t)
	cache := registryMathCacheForApp(t, app)
	cache.Clear()
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal(err)
	}
	original := registryMathStateWire(t, app.committed)
	for name, mutate := range map[string]func(*CommittedState){
		"event index": func(s *CommittedState) { s.ValidatorRegistry.Events[0].Index++ },
		"event order": func(s *CommittedState) { s.ValidatorRegistry.Events[1].TransactionIndex = 0 },
		"ABCI identity": func(s *CommittedState) {
			s.ValidatorRegistry.Events[0].ABCIHash = s.ValidatorRegistry.Events[0].OperationHash
		},
		"operation identity":            func(s *CommittedState) { s.ValidatorRegistry.Events[0].OperationHash = "0x" + strings.Repeat("0", 64) },
		"historical execution height":   func(s *CommittedState) { s.Height++; s.ValidatorRegistry.Events[0].Height++ },
		"event beyond committed height": func(s *CommittedState) { s.Height-- },
		"history root":                  func(s *CommittedState) { s.ValidatorRegistry.Root = strings.Repeat("0", 64) },
		"bootstrap membership":          func(s *CommittedState) { s.ValidatorRegistry.Bootstrap.Members[0].Power++ },
		"missing original bootstrap":    func(s *CommittedState) { s.bootstrap = nil },
		"different bootstrap owner":     func(s *CommittedState) { s.bootstrap = detachValidatedBootstrap(s.bootstrap) },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := app.committed
			candidate.ValidatorRegistry = cloneValidatorRegistry(app.committed.ValidatorRegistry)
			mutate(&candidate)
			before := cache.Stats()
			wire := registryMathStateWire(t, candidate)
			if err := validateValidatorRegistryStateOwned(candidate, app.validatedMigration); err == nil {
				t.Fatal("warm mathematical entry authorized changed dynamic registry context")
			}
			if err := candidate.validateOwned(app.validatedMigration); err == nil {
				t.Fatal("complete owning state validation accepted changed registry context")
			}
			after := cache.Stats()
			if after.Entries != before.Entries || after.RetainedKeyBytes != before.RetainedKeyBytes {
				t.Fatal("dynamic rejection added or replaced mathematical entries")
			}
			if name == "history root" && after.Hits <= before.Hits {
				t.Fatal("root mismatch did not exercise already-cached successful mathematics")
			}
			if !bytes.Equal(wire, registryMathStateWire(t, candidate)) || !bytes.Equal(original, registryMathStateWire(t, app.committed)) {
				t.Fatal("rejection changed caller state or aliased its committed original")
			}
		})
	}
	for _, branch := range []string{"legacy authority", "MLDSA87 possession", "SLHDSA possession"} {
		t.Run(branch, func(t *testing.T) {
			candidate := app.committed
			candidate.ValidatorRegistry = cloneValidatorRegistry(app.committed.ValidatorRegistry)
			event := &candidate.ValidatorRegistry.Events[0]
			registration, err := ynxconsensusauth.DecodeRegistration(event.Wire)
			if err != nil {
				t.Fatal(err)
			}
			switch branch {
			case "legacy authority":
				registration.LegacyApproval[0] ^= 1
			case "MLDSA87 possession":
				registration.PossessionMLDSA87[0] ^= 1
			case "SLHDSA possession":
				registration.PossessionSLHDSASHA2256f[0] ^= 1
			}
			badWire, err := registration.MarshalBinary()
			if err != nil {
				t.Fatal(err)
			}
			// Keep both original outer identities consistent with the corrupted
			// signature bytes, so an identity guard cannot replace actual math.
			registryMathRewriteEvent(t, event, badWire)
			before := cache.Stats()
			wire := registryMathStateWire(t, candidate)
			if err := validateValidatorRegistryStateOwned(candidate, app.validatedMigration); err == nil {
				t.Fatal("signature corruption reused the original successful math group")
			}
			after := cache.Stats()
			if after.Misses != before.Misses+1 || after.Hits != before.Hits || after.Entries != before.Entries ||
				after.RetainedKeyBytes != before.RetainedKeyBytes {
				t.Fatalf("changed signature skipped real math or polluted success entries: before=%+v after=%+v", before, after)
			}
			// Failures are never remembered as successful mathematics.
			if err := validateValidatorRegistryStateOwned(candidate, app.validatedMigration); err == nil {
				t.Fatal("repeated invalid wire was accepted")
			}
			again := cache.Stats()
			if again.Misses != after.Misses+1 || again.Hits != after.Hits || again.Entries != after.Entries {
				t.Fatal("invalid signature wire acquired a reusable cache fact")
			}
			if !bytes.Equal(wire, registryMathStateWire(t, candidate)) || !bytes.Equal(original, registryMathStateWire(t, app.committed)) {
				t.Fatal("failed proof mutated candidate or committed original bytes")
			}
		})
	}
}

func TestValidatorRegistryMathCacheColdRestartReverifiesWithIndependentOwner(t *testing.T) {
	f, app, path := registryMathCacheCommittedFixture(t)
	warm := registryMathCacheForApp(t, app)
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal(err)
	}
	warmStats := warm.Stats()
	original := registryMathStateWire(t, app.committed)
	if warmStats.Entries != 2 || warmStats.Hits == 0 {
		t.Fatal("source application does not have the original warmed math groups")
	}
	if _, err := NewPersistentApplication(f.migration, path); err == nil {
		t.Fatal("warm mathematics supplied a missing independently pinned bootstrap")
	}
	other := newValidatorRegistryFixture(t)
	if _, err := NewPersistentApplicationWithBootstrap(f.migration, path, other.bootstrap); err == nil {
		t.Fatal("warm mathematics supplied a substituted genesis/bootstrap")
	}
	cold, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal("real cold restart failed:", err)
	}
	fresh := registryMathCacheForApp(t, cold)
	stats := fresh.Stats()
	if cold.validatedMigration == app.validatedMigration || fresh == warm || stats.Misses < 2 || stats.Entries != 2 {
		t.Fatalf("cold owner inherited warm authority instead of checking both original events: %+v", stats)
	}
	if warm.Stats() != warmStats || !bytes.Equal(original, registryMathStateWire(t, cold.committed)) || cold.committed.AppHash != app.committed.AppHash {
		t.Fatal("cold construction mutated the old owner's cache or complete committed state")
	}
	if err := cold.committed.validateOwned(cold.validatedMigration); err != nil {
		t.Fatal(err)
	}
	after := fresh.Stats()
	if after.Misses != stats.Misses || after.Hits != stats.Hits+2 {
		t.Fatal("cold owner's independently verified facts were not reused within that owner")
	}
	if err := cold.committed.validateOwned(app.validatedMigration); err == nil {
		t.Fatal("another owner's warmed witness authorized cold bootstrap identity")
	}
	if warm.Stats() != warmStats || !bytes.Equal(original, registryMathStateWire(t, cold.committed)) {
		t.Fatal("foreign-owner refusal changed the original warm cache or cold state")
	}
}

func TestValidatorRegistryMathCacheOwnedSnapshotsRetainWitnessAndDynamicChecks(t *testing.T) {
	_, app, _ := registryMathCacheCommittedFixture(t)
	cache := registryMathCacheForApp(t, app)
	cache.Clear()
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal(err)
	}
	before := cache.Stats()
	snapshot, err := newPQEngineSnapshotOwned(app.validatedMigration, app.bootstrap, app.committed.ValidatorRegistry, app.committed.PQEngineSchedule, app.committed.Height)
	if err != nil || snapshot == nil || snapshot.through != app.committed.Height {
		t.Fatal("exact owned snapshot rejected its complete dynamic registry", err)
	}
	after := cache.Stats()
	if after.Misses != before.Misses || after.Hits != before.Hits+2 {
		t.Fatal("owned snapshot repeated successful registration mathematics")
	}
	// A standalone constructor still performs its own full cold replay and
	// cannot prime or borrow this application's private mathematical facts.
	if _, err := newPQEngineSnapshot(app.bootstrap, app.committed.ValidatorRegistry, app.committed.PQEngineSchedule, app.committed.Height); err != nil || cache.Stats() != after {
		t.Fatal("public cold snapshot borrowed the owning cache", err)
	}
	for _, test := range []struct {
		witness   *validatedMigration
		bootstrap *ConsensusBootstrap
	}{
		{nil, app.bootstrap}, {app.validatedMigration, nil},
		{app.validatedMigration, detachValidatedBootstrap(app.bootstrap)},
	} {
		before := cache.Stats()
		if got, err := newPQEngineSnapshotOwned(test.witness, test.bootstrap, app.committed.ValidatorRegistry, nil, app.committed.Height); err == nil || got != nil || cache.Stats() != before {
			t.Fatal("owned snapshot accepted a missing/foreign bootstrap witness or touched its cache", err)
		}
	}
	bad := cloneValidatorRegistry(app.committed.ValidatorRegistry)
	bad.Root = strings.Repeat("0", 64)
	before = cache.Stats()
	if got, err := newPQEngineSnapshotOwned(app.validatedMigration, app.bootstrap, bad, nil, app.committed.Height); err == nil || got != nil {
		t.Fatal("cached mathematics authorized a changed registry root", err)
	}
	if after := cache.Stats(); after.Misses != before.Misses || after.Hits != before.Hits+2 || after.Entries != before.Entries {
		t.Fatal("root rejection did not fully replay the independently cached original events")
	}
}

func TestValidatorRegistryMathCacheApplicationAndOwnedFileSnapshotsReuseOnlyMath(t *testing.T) {
	f, app, authorization, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	cache := registryMathCacheForApp(t, app)
	cache.Clear()
	if err := app.committed.validateOwned(app.validatedMigration); err != nil {
		t.Fatal(err)
	}
	count := len(app.committed.ValidatorRegistry.Events)
	if cache.Stats().Entries != count || count != len(f.bootstrap.record.Members) {
		t.Fatal("fixture did not authenticate every original validator")
	}
	checkOwnedFile := func() {
		t.Helper()
		original, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		hash, err := hex.DecodeString(app.committed.AppHash)
		if err != nil {
			t.Fatal(err)
		}
		before := cache.Stats()
		snapshot, err := loadPQEngineSnapshotOwned(app.validatedMigration, path, authorization, nil, app.committed.Height, hash, capturePQEngineState)
		if err != nil || snapshot == nil || snapshot.through != app.committed.Height {
			t.Fatal("normal owned file snapshot lost actual height/AppHash or independent schedule", err)
		}
		if after := cache.Stats(); after.Misses != before.Misses || after.Hits <= before.Hits || after.Entries != before.Entries {
			t.Fatal("owned file read repeated original mathematical verification")
		}
		current, err := os.Stat(path)
		actual, readErr := os.ReadFile(path)
		if err != nil || readErr != nil || !os.SameFile(info, current) || info.Mode() != current.Mode() || info.Size() != current.Size() || !info.ModTime().Equal(current.ModTime()) || !bytes.Equal(original, actual) {
			t.Fatal("read-only snapshot changed the original committed file", err, readErr)
		}
		for _, target := range []struct {
			height int64
			hash   []byte
		}{
			{app.committed.Height + 1, hash}, {app.committed.Height, bytes.Repeat([]byte{0x59}, 32)},
		} {
			if got, err := loadPQEngineSnapshotOwned(app.validatedMigration, path, authorization, nil, target.height, target.hash, capturePQEngineState); err == nil || got != nil {
				t.Fatal("warm mathematics authorized a foreign committed height/AppHash", err)
			}
		}
	}
	// Before schedule admission this also exercises the independent authorized
	// future schedule check in the normal owned constructor/file-reader path.
	checkOwnedFile()
	before := cache.Stats()
	snapshot, err := app.CommittedPQEngineSnapshot()
	if err != nil || snapshot == nil || cache.Stats().Misses != before.Misses || cache.Stats().Hits != before.Hits+uint64(count) {
		t.Fatal("committed accessor repeated original math or lost complete dynamic replay", err)
	}
	nextHash, err := snapshot.ExpectedValidatorHash(schedule.AuthorizedAt + 1)
	if err != nil {
		t.Fatal(err)
	}
	response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: nextHash})
	if err != nil || response == nil || app.pending == nil || app.pending.PQEngineSchedule == nil || cache.Stats().Misses != before.Misses {
		t.Fatal("normal scheduled Finalize repeated math or lost original admission ordering", err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil || cache.Stats().Misses != before.Misses {
		t.Fatal("normal scheduled Commit did not reuse only original mathematics", err)
	}
	checkOwnedFile()
	snapshot, err = app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	nextHeight := app.committed.Height + 1
	nextHash, err = snapshot.ExpectedValidatorHash(nextHeight + 1)
	if err != nil {
		t.Fatal(err)
	}
	before = cache.Stats()
	processed, err := app.ProcessProposal(context.Background(), &abci.RequestProcessProposal{Height: nextHeight, NextValidatorsHash: nextHash})
	if err != nil || processed.Status != abci.ResponseProcessProposal_ACCEPT || cache.Stats().Misses != before.Misses || cache.Stats().Hits <= before.Hits || app.pending != nil {
		t.Fatal("normal next-validator validation lost dynamic checks or repeated original mathematics", err)
	}
}
