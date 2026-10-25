package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func newStakingOriginalInspectionFixture(t *testing.T, layout string) (*operatorInspectionFixture, [][]byte) {
	t.Helper()
	h := newFourMemberInspectionHarness(t)
	f := newOperatorInspectionFixtureWithHarness(t, layout, h, 0)
	stateDB, err := dbm.NewGoLevelDB("state", f.options.CometDataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer stateDB.Close()
	blocksDB, err := dbm.NewGoLevelDB("blockstore", f.options.CometDataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer blocksDB.Close()
	blocks := blockstore.NewBlockStore(blocksDB)
	for height := h.blocks.Base(); height <= h.blocks.Height(); height++ {
		block, commit := h.blocks.LoadBlock(height), h.blocks.LoadSeenCommit(height)
		if block == nil || commit == nil {
			t.Fatal("original real BlockExecutor fixture lacks its committed block")
		}
		parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
		if err != nil {
			t.Fatal(err)
		}
		blocks.SaveBlock(block, parts, commit)
	}
	h.raw, h.blocks = sm.NewStore(stateDB, sm.StoreOptions{}), blocks
	key := deterministicPrivateKey(111)
	t.Cleanup(key.Zero)
	owner := mustNativeAddress(t, key)
	position, ok := accountIndex(h.app.committed.Accounts, owner)
	if !ok {
		t.Fatal("original funded owner missing")
	}
	nonce := h.app.committed.Accounts[position].Nonce
	v0, v1 := h.f.migration.Validators[0].Address, h.f.migration.Validators[1].Address
	id := stakingDelegationID(owner, v0)
	delegate := mustStakingAction(t, key, ActionStakeDelegate, StakeDelegatePayload{Validator: v0, AmountYNXT: 40}, nonce+1)
	other := mustStakingAction(t, key, ActionStakeDelegate, StakeDelegatePayload{Validator: v1, AmountYNXT: 30}, nonce+2)
	unbond := mustStakingAction(t, key, ActionStakeUnbond, StakeUnbondPayload{DelegationID: id, AmountYNXT: 7}, nonce+3)
	queued := mustStakingAction(t, key, ActionStakeUnbond, StakeUnbondPayload{DelegationID: id, AmountYNXT: 5}, nonce+4)
	f.actual = applyInspectionStakingBlock(t, h, cmttypes.Txs{delegate, other, unbond, queued}, time.Duration(StakingUnbondingSeconds)*time.Second)
	withdraw := mustStakingAction(t, key, ActionStakeWithdraw, StakeWithdrawPayload{UnbondingID: ApplicationActionRecordID("stake-unbonding", ApplicationActionHash(unbond))}, nonce+5)
	f.actual = applyInspectionStakingBlock(t, h, cmttypes.Txs{withdraw}, 0)
	f.options.LegacyStakingOwner = owner
	return f, [][]byte{delegate, other, unbond, queued, withdraw}
}

func stakingInspectionRoots(f *operatorInspectionFixture) []string {
	return []string{filepath.Dir(f.options.StatePath), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
}

func TestInspectOperatorCheckpointLegacyStakingOriginalsAllLayouts(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f, originals := newStakingOriginalInspectionFixture(t, layout)
			before := inspectionInventory(t, stakingInspectionRoots(f)...)
			result, err := f.inspect()
			if err != nil || result.LegacyStakingOriginals == nil {
				t.Fatal("real stopped ledger originals unavailable", err)
			}
			observed := result.LegacyStakingOriginals
			if observed.Version != OperatorLegacyStakingOriginalsVersion || observed.Owner != f.options.LegacyStakingOwner || observed.Height != f.actual.LastBlockHeight || observed.AppHash != hex.EncodeToString(f.actual.AppHash) || !sameStakingOriginals(observed.Originals, originals) || len(observed.Coordinates) != len(originals) || result.PQActivationVerified {
				t.Fatal("export substituted original transactions or checkpoint", observed)
			}
			fees := legacyStakingFees(f.h.app.committed.FeeEvents, observed.Owner)
			for i, point := range observed.Coordinates {
				wantIndex := uint64(i)
				if i == len(originals)-1 {
					wantIndex = 0
				}
				if point.Height != fees[i].BlockHeight || point.Index != wantIndex || point.TransactionHash != ApplicationActionHash(originals[i]) || point.TransactionType != fees[i].TransactionType || !point.RecordedAt.Equal(fees[i].RecordedAt) || len(point.BlockHash) != 64 {
					t.Fatal("export lost actual block coordinate or original successful fee", i, point)
				}
			}
			if err := ValidateLegacyStakingOriginals(f.h.app.committed, f.h.f.migration, observed.Owner, observed.Originals); err != nil {
				t.Fatal("normal exported originals fail the actual witness verifier", err)
			}
			var decoded OperatorCheckpointResult
			if err := json.Unmarshal(mustJSON(t, result), &decoded); err != nil || !reflect.DeepEqual(decoded.LegacyStakingOriginals, observed) {
				t.Fatal("public original bytes or exact coordinates changed through JSON", err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, stakingInspectionRoots(f)...)) {
				t.Fatal("normal collection modified original App/DB/BlockStore/HRS/locks")
			}
		})
	}
}

// Each negative receives a complete detached copy of a stopped normal source.
// Only signed immutable fixture construction is shared; no mutable DB/lock or
// response cache is reused between cases.
func copyStakingInspectionFixture(t *testing.T, source *operatorInspectionFixture) *operatorInspectionFixture {
	t.Helper()
	root := t.TempDir()
	cloneTree := func(original, name string) string {
		destination := filepath.Join(root, name)
		if err := filepath.Walk(original, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			relative, err := filepath.Rel(original, path)
			if err != nil {
				return err
			}
			target := filepath.Join(destination, relative)
			if info.IsDir() {
				return os.Mkdir(target, info.Mode().Perm())
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("fixture source must be regular: %s", relative)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return os.WriteFile(target, raw, info.Mode().Perm())
		}); err != nil {
			t.Fatal(err)
		}
		return destination
	}
	app := cloneTree(filepath.Dir(source.options.StatePath), "application")
	signing := cloneTree(filepath.Dir(source.options.SigningStatePath), "signing")
	home := cloneTree(filepath.Dir(source.options.CometDataDirectory), "home")
	f := *source
	f.options.StatePath = filepath.Join(app, filepath.Base(source.options.StatePath))
	f.options.SigningStatePath = filepath.Join(signing, filepath.Base(source.options.SigningStatePath))
	f.options.CometDataDirectory = filepath.Join(home, filepath.Base(source.options.CometDataDirectory))
	return &f
}

func TestInspectOperatorCheckpointLegacyStakingOriginalsRejectMissingAndTamperedStores(t *testing.T) {
	seed, _ := newStakingOriginalInspectionFixture(t, "atomic-json")
	first := legacyStakingFees(seed.h.app.committed.FeeEvents, seed.options.LegacyStakingOwner)[0].BlockHeight
	for _, kind := range []string{"missing-block", "corrupt-block", "corrupt-part", "corrupt-store", "missing-result", "corrupt-result", "result-code", "result-data", "result-index", "result-apphash", "wrong-owner", "missing-lock", "active-block-writer"} {
		t.Run(kind, func(t *testing.T) {
			f := copyStakingInspectionFixture(t, seed)
			var active dbm.DB
			switch kind {
			case "wrong-owner":
				f.options.LegacyStakingOwner = mustNativeAddress(t, deterministicPrivateKey(112))
			case "missing-lock":
				if err := os.Remove(filepath.Join(f.options.CometDataDirectory, "blockstore.db", "LOCK")); err != nil {
					t.Fatal(err)
				}
			default:
				name := "blockstore"
				if kind == "missing-result" || kind == "corrupt-result" || len(kind) >= 7 && kind[:7] == "result-" {
					name = "state"
				}
				db, err := dbm.NewGoLevelDB(name, f.options.CometDataDirectory)
				if err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "active-block-writer":
					active = db
				case "missing-block":
					err = db.DeleteSync([]byte(fmt.Sprintf("H:%d", first)))
				case "corrupt-block":
					err = db.SetSync([]byte(fmt.Sprintf("H:%d", first)), []byte{0xff})
				case "corrupt-part":
					err = db.SetSync([]byte(fmt.Sprintf("P:%d:0", first)), []byte{0xff})
				case "corrupt-store":
					err = db.SetSync([]byte("blockStore"), []byte{0xff})
				case "missing-result":
					err = db.DeleteSync([]byte(fmt.Sprintf("abciResponsesKey:%d", first)))
				case "corrupt-result":
					err = db.SetSync([]byte(fmt.Sprintf("abciResponsesKey:%d", first)), []byte{0xff})
				default:
					store := sm.NewStore(db, sm.StoreOptions{})
					response, loadErr := store.LoadFinalizeBlockResponse(first)
					if loadErr != nil || len(response.TxResults) < 2 {
						t.Fatal("fixture lacks real results", loadErr)
					}
					switch kind {
					case "result-code":
						response.TxResults[0].Code = 1
					case "result-data":
						response.TxResults[0].Data = []byte("substituted")
					case "result-index":
						response.TxResults[0], response.TxResults[1] = response.TxResults[1], response.TxResults[0]
					case "result-apphash":
						response.AppHash = bytes.Repeat([]byte{0x31}, 32)
					}
					err = store.SaveFinalizeBlockResponse(first, response)
				}
				if err != nil {
					t.Fatal(err)
				}
				if active == nil {
					if err = db.Close(); err != nil {
						t.Fatal(err)
					}
				}
			}
			if active != nil {
				defer active.Close()
			}
			before := inspectionInventory(t, stakingInspectionRoots(f)...)
			result, err := f.inspect()
			if err == nil || result.LegacyStakingOriginals != nil {
				t.Fatal("unavailable or substituted original bytes became a successful witness", kind, result, err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, stakingInspectionRoots(f)...)) {
				t.Fatal("failed collection repaired or changed original material", kind)
			}
		})
	}
	t.Run("empty-option-preserves-original-inspection", func(t *testing.T) {
		f := copyStakingInspectionFixture(t, seed)
		f.options.LegacyStakingOwner = ""
		if err := os.RemoveAll(filepath.Join(f.options.CometDataDirectory, "blockstore.db")); err != nil {
			t.Fatal(err)
		}
		before := inspectionInventory(t, stakingInspectionRoots(f)...)
		result, err := f.inspect()
		if err != nil || result.LegacyStakingOriginals != nil || bytes.Contains(mustJSON(t, result), []byte(`"legacyStakingOriginals"`)) {
			t.Fatal("optional originals changed the existing inspection contract", err)
		}
		if !reflect.DeepEqual(before, inspectionInventory(t, stakingInspectionRoots(f)...)) {
			t.Fatal("empty option created or repaired missing block storage")
		}
	})
}
