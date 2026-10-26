package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func preservePQEngineCheckpoint(t *testing.T, path string) func() {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	inventory := pqReadInventory(t, path)
	return func() {
		t.Helper()
		current, statErr := os.Lstat(path)
		actual, readErr := os.ReadFile(path)
		if statErr != nil || readErr != nil || !samePQStateFile(info, current) || !bytes.Equal(raw, actual) || !reflect.DeepEqual(inventory, pqReadInventory(t, path)) {
			t.Fatal("read-only checkpoint validation changed an original inode, bytes, metadata or directory entry", statErr, readErr)
		}
	}
}

func TestPQEngineCheckpointValidationOwnedReadAndColdAuthority(t *testing.T) {
	f, app, authorization, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	unchanged := preservePQEngineCheckpoint(t, path)
	witness := app.validatedMigration
	cache := registryMathCacheForApp(t, app)
	cache.Clear()
	if err := app.committed.validateOwned(witness); err != nil {
		t.Fatal(err)
	}
	count := uint64(len(app.committed.ValidatorRegistry.Events))
	if count == 0 || uint64(cache.Stats().Entries) != count {
		t.Fatal("fixture did not fully authenticate its actual committed registry")
	}
	hash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	checks, before := validatedMigrationFullChecks.Load(), cache.Stats()
	snapshot, err := loadPQEngineSnapshotOwned(witness, path, authorization, nil, app.committed.Height, hash, capturePQEngineState)
	if err != nil || snapshot == nil || snapshot.through != app.committed.Height || !reflect.DeepEqual(snapshot.registry, app.committed.ValidatorRegistry) {
		t.Fatal("actual committed checkpoint lost its complete authenticated registry", err)
	}
	if _, err := snapshot.ExpectedValidatorHash(schedule.AuthorizedAt + 1); err != nil {
		t.Fatal("the original bounded H+2 membership validation was not retained", err)
	}
	// Diagnostic only: one complete read validation, one independently pinned
	// future-schedule replay and one committed snapshot replay. No second full
	// ledger validation is needed for the identical private returned value.
	after := cache.Stats()
	if after.Misses != before.Misses || after.Hits != before.Hits+3*count || after.Entries != before.Entries || validatedMigrationFullChecks.Load() != checks {
		t.Fatal("owned file path rebuilt its anchor, repeated complete validation or omitted a required registry replay", before, after)
	}
	// The public entry must still establish a fresh owner; neither it nor an
	// independently created cold witness may borrow the warm owner's cache.
	if got, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, authorization, app.committed.Height, hash); err != nil || got == nil || got.through != snapshot.through || validatedMigrationFullChecks.Load() != checks+1 || cache.Stats() != after {
		t.Fatal("public cold source lost independent validation or borrowed warm authority", err)
	}
	cold, err := newValidatedMigration(f.migration, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := loadPQEngineSnapshotOwned(cold, path, authorization, nil, app.committed.Height, hash, capturePQEngineState); err != nil || got == nil || cold == witness || cold.registryMath == cache || cold.registryMath.Stats().Misses != count || cache.Stats() != after {
		t.Fatal("independent cold owner did not verify every original registration", err)
	}
	if got, err := loadPQEngineSnapshotOwned(nil, path, authorization, nil, app.committed.Height, hash, func(string) (*pqEngineStateRead, error) {
		t.Fatal("missing private witness reached file acquisition")
		return nil, nil
	}); err == nil || got != nil {
		t.Fatal("missing private owner authorized a checkpoint")
	}
	// A second genuinely pinned Comet Genesis with the SAME migration remains
	// a different owner. The original file's bootstrap cannot authorize it.
	var otherDoc cmttypes.GenesisDoc
	if err := cmtjson.Unmarshal(f.raw, &otherDoc); err != nil {
		t.Fatal(err)
	}
	otherDoc.GenesisTime = otherDoc.GenesisTime.Add(time.Second)
	otherRaw, err := cmtjson.Marshal(otherDoc)
	if err != nil {
		t.Fatal(err)
	}
	otherPins := f.pins
	otherHash := sha256.Sum256(otherRaw)
	otherPins.CometGenesisSHA256 = hex.EncodeToString(otherHash[:])
	otherBootstrap, err := NewConsensusBootstrap(otherRaw, otherPins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := newValidatedMigration(f.migration, otherBootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := loadPQEngineSnapshotOwned(foreign, path, authorization, nil, app.committed.Height, hash, capturePQEngineState); err == nil || got != nil || cache.Stats() != after {
		t.Fatal("same migration or warm mathematics substituted a foreign Comet Genesis", err)
	}
	unchanged()
}

func TestPQEngineCheckpointValidationResealedLedgerAndCoordinates(t *testing.T) {
	_, app, authorization, _, path, _ := persistentEngineAuthorizationFixture(t)
	witness := app.validatedMigration
	hash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	unchanged := preservePQEngineCheckpoint(t, path)
	for _, target := range []struct {
		height int64
		hash   []byte
		cause  string
	}{
		{app.committed.Height + 1, hash, "application authority height differs"},
		{app.committed.Height, bytes.Repeat([]byte{0x63}, 32), "application authority AppHash differs"},
	} {
		got, err := loadPQEngineSnapshotOwned(witness, path, authorization, nil, target.height, target.hash, capturePQEngineState)
		if err == nil || got != nil || !strings.Contains(err.Error(), target.cause) {
			t.Fatal("independent checkpoint coordinate or its original error order was lost", err)
		}
		unchanged()
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var bad CommittedState
	if err := decodeStrictJSON(raw, &bad); err != nil {
		t.Fatal(err)
	}
	bad.bootstrap = witness.bootstrap
	bad.Accounts[0].Balance++
	bad.AppHash, err = bad.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	want := bad.validateOwned(witness)
	if want == nil {
		t.Fatal("resealed ledger mutation did not violate a full state invariant")
	}
	badRaw, err := encodeCommittedStateJSON(bad)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, badRaw, 0600); err != nil {
		t.Fatal(err)
	}
	// Preserve this original invalid input too: failure must not repair it or
	// fall back to the application's earlier authentic committed state.
	unchanged = preservePQEngineCheckpoint(t, path)
	badHash, err := hex.DecodeString(bad.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	for _, height := range []int64{bad.Height, bad.Height + 1} {
		got, err := loadPQEngineSnapshotOwned(witness, path, authorization, nil, height, badHash, capturePQEngineState)
		if err == nil || got != nil || err.Error() != "read committed engine authority: validate read-only committed source: "+want.Error() {
			t.Fatal("matching resealed AppHash hid a bad ledger, or coordinate checking displaced full read validation", err)
		}
		unchanged()
	}
}

func TestPQEngineCheckpointValidationOriginalReadbackAndClose(t *testing.T) {
	_, app, authorization, _, path, _ := persistentEngineAuthorizationFixture(t)
	hash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	unchanged := preservePQEngineCheckpoint(t, path)
	for _, scenario := range []string{"valid", "wrong-height", "original-changed", "close-failed"} {
		t.Run(scenario, func(t *testing.T) {
			first := errors.New("original checkpoint " + scenario)
			var held *os.File
			var calls []string
			capture := func(name string) (*pqEngineStateRead, error) {
				r, err := capturePQEngineState(name)
				if err != nil {
					return nil, err
				}
				held, err = os.Open(name)
				if err != nil {
					return nil, err
				}
				original := *r
				r.checkOriginal = func() error {
					calls = append(calls, "unchanged")
					if err := original.unchanged(); err != nil {
						return err
					}
					if scenario == "original-changed" {
						return first
					}
					return nil
				}
				r.closeOriginal = func() error {
					calls = append(calls, "close")
					err := held.Close()
					if scenario == "close-failed" {
						return errors.Join(err, first)
					}
					return err
				}
				return r, nil
			}
			height := app.committed.Height
			if scenario == "wrong-height" || scenario == "original-changed" || scenario == "close-failed" {
				height++
			}
			got, err := loadPQEngineSnapshotOwned(app.validatedMigration, path, authorization, nil, height, hash, capture)
			if scenario == "valid" && (err != nil || got == nil) || scenario != "valid" && (err == nil || got != nil) {
				t.Fatal("original file readback/close did not gate returned authority", scenario, err)
			}
			if (scenario == "original-changed" || scenario == "close-failed") && !errors.Is(err, first) {
				t.Fatal("original readback/close first cause was displaced by a later coordinate check", err)
			}
			if !reflect.DeepEqual(calls, []string{"unchanged", "close"}) || held == nil {
				t.Fatal("original file checks or owned close were omitted/repeated", calls)
			}
			if _, err := held.Stat(); !errors.Is(err, os.ErrClosed) {
				t.Fatal("returned snapshot retained the original read descriptor", err)
			}
			unchanged()
		})
	}
}

func TestPQEngineCheckpointValidationKeepsIndependentSchedulePin(t *testing.T) {
	f, app, authorization, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	snapshot, err := app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	next, err := snapshot.ExpectedValidatorHash(schedule.AuthorizedAt + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: next}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	if app.committed.PQEngineSchedule == nil {
		t.Fatal("normal Commit did not persist the independently admitted schedule")
	}
	unchanged := preservePQEngineCheckpoint(t, path)
	hash, err := hex.DecodeString(app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := loadPQEngineSnapshotOwned(app.validatedMigration, path, nil, nil, app.committed.Height, hash, capturePQEngineState); err == nil || got != nil || !strings.Contains(err.Error(), "requires independent operator pin") {
		t.Fatal("fully valid committed schedule became self-authorizing", err)
	}
	if got, err := LoadPQEngineSnapshot(f.migration, path, f.bootstrap, authorization, app.committed.Height, hash); err != nil || got == nil || got.schedule == nil {
		t.Fatal("normal independently pinned cold scheduled read failed", err)
	}
	unchanged()
}
